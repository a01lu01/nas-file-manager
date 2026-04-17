fn main() {
    let input = "Https://192.168.2.200:5300/临时空间".to_string();
    let parsed_res = reqwest::Url::parse(&input.to_lowercase());
    println!("parsed_res = {:?}", parsed_res);
    let url = "Https://192.168.2.200:5300/TempSpace";
    println!("to_lowercase = {}", url.to_lowercase());
}
