use super::{FileItem, Storage, VfsError};
use async_trait::async_trait;
use reqwest::{Client, Method, RequestBuilder};
use reqwest::header::CONTENT_LENGTH;
use base64::{engine::general_purpose, Engine as _};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::any::Any;

pub struct WebDavStorage {
    client: Client,
    origin: String,
    base_path: String,
    auth_header: Option<String>,
}

impl WebDavStorage {
    pub fn new(url: &str, user: &str, pass: &str) -> Self {
        let auth = if !user.is_empty() {
            let credentials = format!("{}:{}", user, pass);
            let encoded = general_purpose::STANDARD.encode(credentials);
            Some(format!("Basic {}", encoded))
        } else {
            None
        };

        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap_or_else(|_| Client::new());

        let input = url.trim_end_matches('/').to_string();
        // Support lowercase and uppercase http/https scheme mapping
        let parsed_res = if input.to_lowercase().starts_with("http") {
            reqwest::Url::parse(&input)
        } else {
            reqwest::Url::parse(&format!("http://{}", input))
        };
        
        let (origin, base_path) = if let Ok(parsed) = parsed_res {
            let mut o = format!("{}://{}", parsed.scheme(), parsed.host_str().unwrap_or(""));
            if let Some(port) = parsed.port() {
                o = format!("{}:{}", o, port);
            }
            let raw_path = parsed.path();
            let decoded_path = urlencoding::decode(raw_path)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| raw_path.to_string());
            let mut p = decoded_path.trim_end_matches('/').to_string();
            if p == "/" {
                p.clear();
            }
            (o, p)
        } else {
            (input, "".to_string())
        };

        Self {
            client,
            origin,
            base_path,
            auth_header: auth,
        }
    }

    fn encode_path_parts(path: &str) -> String {
        let mut encoded_parts = Vec::new();
        for part in path.split('/') {
            if part.is_empty() {
                continue;
            }
            if part.contains('%') {
                encoded_parts.push(part.to_string());
            } else {
                encoded_parts.push(urlencoding::encode(part).into_owned());
            }
        }
        encoded_parts.join("/")
    }

    fn full_url(&self, path: &str, ensure_dir_slash: bool) -> String {
        let base = self.base_path.trim_matches('/').to_string();
        let base_encoded = Self::encode_path_parts(&base);

        let rel = path.trim_matches('/').to_string();
        let rel_encoded = Self::encode_path_parts(&rel);

        let mut url = self.origin.clone();
        if !base_encoded.is_empty() {
            url.push('/');
            url.push_str(&base_encoded);
        }
        if !rel_encoded.is_empty() {
            url.push('/');
            url.push_str(&rel_encoded);
        }

        if ensure_dir_slash && !url.ends_with('/') {
            url.push('/');
        }

        url
    }

    fn build_request(&self, method: Method, path: &str, ensure_dir_slash: bool) -> RequestBuilder {
        let url = self.full_url(path, ensure_dir_slash);
        let mut req = self.client.request(method, &url);
        if let Some(auth) = &self.auth_header {
            req = req.header("Authorization", auth);
        }
        req
    }

    fn full_path_for_compare(&self, path: &str) -> String {
        let base = self.base_path.trim_end_matches('/').to_string();
        let rel = path.trim_matches('/').to_string();
        if base.is_empty() && rel.is_empty() {
            "/".to_string()
        } else if base.is_empty() {
            format!("/{}", rel)
        } else if rel.is_empty() {
            base
        } else {
            format!("{}/{}", base, rel)
        }
    }

    pub async fn open_download(
        &self,
        path: &str,
        range_start: u64,
    ) -> Result<(reqwest::Response, Option<u64>), VfsError> {
        let mut req = self.build_request(Method::GET, path, false);
        if range_start > 0 {
            req = req.header("Range", format!("bytes={}-", range_start));
        }

        let res = req
            .send()
            .await
            .map_err(|e| VfsError::NetworkError(e.to_string()))?;

        if res.status().is_success()
            || res.status() == reqwest::StatusCode::PARTIAL_CONTENT
            || res.status() == reqwest::StatusCode::CREATED
        {
            let len = res
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            let total = len.map(|l| l + range_start);
            Ok((res, total))
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(VfsError::AuthFailed)
        } else if res.status() == reqwest::StatusCode::FORBIDDEN {
            Err(VfsError::PermissionDenied)
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            Err(VfsError::NotFound(path.to_string()))
        } else {
            Err(VfsError::NetworkError(format!("HTTP {}", res.status())))
        }
    }
}

#[async_trait]
impl Storage for WebDavStorage {
    fn as_any(&self) -> &dyn Any {
        self
    }

    async fn ping(&self) -> Result<bool, VfsError> {
        let req = self.build_request(Method::from_bytes(b"PROPFIND").unwrap(), "/", true)
            .header("Depth", "0");
            
        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
        
        if res.status().is_success() || res.status() == reqwest::StatusCode::MULTI_STATUS {
            Ok(true)
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(VfsError::AuthFailed)
        } else {
            Err(VfsError::NetworkError(format!("HTTP {}", res.status())))
        }
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileItem>, VfsError> {
        let req = self.build_request(Method::from_bytes(b"PROPFIND").unwrap(), path, true)
            .header("Depth", "1");
            
        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
        
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(VfsError::AuthFailed);
        }
        if !res.status().is_success() && res.status() != reqwest::StatusCode::MULTI_STATUS {
            return Err(VfsError::NetworkError(format!("HTTP {}", res.status())));
        }
        
        let xml_text = res.text().await.map_err(|e| VfsError::Internal(e.to_string()))?;
        
        let mut reader = Reader::from_str(&xml_text);
        reader.config_mut().trim_text(true);

        let mut items = Vec::new();
        let mut buf = Vec::new();
        
        let mut current_href = String::new();
        let mut current_is_dir = false;
        let mut current_size: u64 = 0;
        let mut current_last_modified: Option<i64> = None;
        
        let mut in_response = false;
        let mut current_tag = String::new();
        let current_full = self.full_path_for_compare(path).trim_end_matches('/').to_string();
        let base_full = self.base_path.trim_end_matches('/').to_string();

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => {
                    let name = String::from_utf8_lossy(e.name().as_ref()).to_lowercase();
                    if name.ends_with("response") {
                        in_response = true;
                        current_href.clear();
                        current_is_dir = false;
                        current_size = 0;
                        current_last_modified = None;
                    } else if in_response {
                        current_tag = name.split(':').last().unwrap_or(&name).to_string();
                    }
                },
                Ok(Event::Empty(e)) => {
                    let name = String::from_utf8_lossy(e.name().as_ref()).to_lowercase();
                    let tag = name.split(':').last().unwrap_or(&name);
                    if tag == "collection" {
                        current_is_dir = true;
                    }
                },
                Ok(Event::Text(e)) => {
                    if in_response {
                        if let Ok(text) = std::str::from_utf8(e.as_ref()) {
                            let text = quick_xml::escape::unescape(text).unwrap_or(text.into()).into_owned();
                            match current_tag.as_str() {
                                "href" => {
                                    if let Ok(decoded) = urlencoding::decode(&text) {
                                        current_href = decoded.into_owned();
                                    } else {
                                        current_href = text;
                                    }
                                },
                                "getcontentlength" => {
                                    current_size = text.parse().unwrap_or(0);
                                },
                                "getlastmodified" => {
                                    // 尝试解析 RFC 1123 时间，如 "Thu, 15 Mar 2023 12:00:00 GMT"
                                    if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(&text) {
                                        current_last_modified = Some(dt.timestamp());
                                    }
                                },
                                _ => {}
                            }
                        }
                    }
                },
                Ok(Event::End(e)) => {
                    let name = String::from_utf8_lossy(e.name().as_ref()).to_lowercase();
                    if name.ends_with("response") {
                        in_response = false;
                        
                        let clean_href = if current_href.starts_with("http") {
                            if let Ok(url) = reqwest::Url::parse(&current_href) {
                                let p = url.path().to_string();
                                urlencoding::decode(&p).map(|s| s.into_owned()).unwrap_or(p)
                            } else {
                                current_href.clone()
                            }
                        } else {
                            current_href.clone()
                        };
                        
                        let href_trimmed = clean_href.trim_end_matches('/').to_string();
                        if !href_trimmed.is_empty() && href_trimmed != current_full {
                            let mut rel_path = if !base_full.is_empty() && href_trimmed.starts_with(&base_full) {
                                let rest = &href_trimmed[base_full.len()..];
                                if rest.is_empty() {
                                    "/".to_string()
                                } else if rest.starts_with('/') {
                                    rest.to_string()
                                } else {
                                    format!("/{}", rest)
                                }
                            } else {
                                if href_trimmed.starts_with('/') {
                                    href_trimmed.clone()
                                } else {
                                    format!("/{}", href_trimmed)
                                }
                            };
                            if rel_path.is_empty() {
                                rel_path = "/".to_string();
                            }

                            let file_name = rel_path.split('/').last().unwrap_or(&rel_path).to_string();
                            
                            items.push(FileItem {
                                name: file_name,
                                path: rel_path,
                                is_dir: current_is_dir,
                                size: current_size,
                                last_modified: current_last_modified,
                                protocol: "webdav".to_string(),
                            });
                        }
                    }
                    current_tag.clear();
                },
                Ok(Event::Eof) => break,
                Err(e) => {
                    log::error!("XML parsing error: {:?}", e);
                    break;
                },
                _ => (),
            }
            buf.clear();
        }
        
        Ok(items)
    }

    async fn mkdir(&self, path: &str) -> Result<(), VfsError> {
        let req = self.build_request(Method::from_bytes(b"MKCOL").unwrap(), path, true);
        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
        if res.status().is_success() {
            Ok(())
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(VfsError::AuthFailed)
        } else if res.status() == reqwest::StatusCode::FORBIDDEN {
            Err(VfsError::PermissionDenied)
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            Err(VfsError::NotFound(path.to_string()))
        } else {
            Err(VfsError::Internal(res.status().to_string()))
        }
    }

    async fn delete(&self, path: &str) -> Result<(), VfsError> {
        let req = self.build_request(Method::DELETE, path, false);
        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
        if res.status().is_success() {
            Ok(())
        } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            Err(VfsError::AuthFailed)
        } else if res.status() == reqwest::StatusCode::FORBIDDEN {
            Err(VfsError::PermissionDenied)
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            Err(VfsError::NotFound(path.to_string()))
        } else {
            Err(VfsError::Internal(res.status().to_string()))
        }
    }

    async fn rename(&self, old_path: &str, new_path: &str) -> Result<(), VfsError> {
        let try_move = |ensure_dir_slash: bool| async move {
            let new_url = self.full_url(new_path, ensure_dir_slash);
            let req = self
                .build_request(Method::from_bytes(b"MOVE").unwrap(), old_path, ensure_dir_slash)
                .header("Destination", &new_url);

            let res = req
                .send()
                .await
                .map_err(|e| VfsError::NetworkError(e.to_string()))?;

            if res.status().is_success() || res.status() == reqwest::StatusCode::CREATED {
                Ok(())
            } else if res.status() == reqwest::StatusCode::UNAUTHORIZED {
                Err(VfsError::AuthFailed)
            } else if res.status() == reqwest::StatusCode::FORBIDDEN {
                Err(VfsError::PermissionDenied)
            } else if res.status() == reqwest::StatusCode::NOT_FOUND {
                Err(VfsError::NotFound(old_path.to_string()))
            } else {
                Err(VfsError::Internal(res.status().to_string()))
            }
        };

        match try_move(false).await {
            Ok(()) => Ok(()),
            Err(VfsError::Internal(s))
                if s.contains("405")
                    || s.contains("301")
                    || s.contains("302")
                    || s.contains("409")
                    || s.contains("412") =>
            {
                try_move(true).await
            },
            Err(e) => Err(e),
        }
    }

    async fn stream_file(&self, path: &str, req_headers: axum::http::HeaderMap) -> Result<axum::response::Response, VfsError> {
        use axum::response::IntoResponse;
        use axum::http::HeaderValue;
        use reqwest::header::{RANGE, IF_NONE_MATCH, IF_MATCH};

        let mut req = self.build_request(Method::GET, path, false);

        // 转发浏览器可能发来的 Range / 条件请求头
        if let Some(r) = req_headers.get(RANGE) {
            req = req.header(RANGE, r.clone());
        }
        if let Some(r) = req_headers.get(IF_NONE_MATCH) {
            req = req.header(IF_NONE_MATCH, r.clone());
        }
        if let Some(r) = req_headers.get(IF_MATCH) {
            req = req.header(IF_MATCH, r.clone());
        }

        let res = req.send().await.map_err(|e| VfsError::NetworkError(e.to_string()))?;
        
        let status = res.status();
        if status.is_client_error() || status.is_server_error() {
            return Err(VfsError::Internal(format!("HTTP Error {}", status)));
        }

        // 将 reqwest 响应的头部复制到 axum 响应中
        let mut headers = axum::http::HeaderMap::new();
        for (name, value) in res.headers() {
            // Remove chunked transfer-encoding to let axum handle it, otherwise it causes protocol errors
            if name.as_str().eq_ignore_ascii_case("transfer-encoding") {
                continue;
            }
            if let Ok(val) = HeaderValue::from_bytes(value.as_bytes()) {
                headers.insert(name.clone(), val);
            }
        }
        
        // 允许跨域
        headers.insert(
            axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*")
        );

        // 强制添加 Cache-Control 头
        headers.insert(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400")
        );

        // 使用 reqwest 的 body_stream 作为 axum 的 body
        let stream = res.bytes_stream();
        let body = axum::body::Body::from_stream(stream);

        let mut axum_res = body.into_response();
        *axum_res.status_mut() = axum::http::StatusCode::from_u16(status.as_u16()).unwrap_or(axum::http::StatusCode::OK);
        *axum_res.headers_mut() = headers;

        Ok(axum_res)
    }
}
