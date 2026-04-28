import { create } from 'zustand';

type Language = 'en' | 'zh';

const getSystemLanguage = (): Language => {
  const lang = navigator.language || (navigator as any).userLanguage;
  if (lang && lang.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
};

interface I18nStore {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  language: (localStorage.getItem('nas-language') as Language) || getSystemLanguage(),
  setLanguage: (lang: Language) => {
    localStorage.setItem('nas-language', lang);
    set({ language: lang });
  },
}));

export const translations = {
  en: {
    // Home
    'home.title': 'Connect to Storage',
    'home.subtitle': 'Add a new NAS connection via SMB or WebDAV to access your files.',
    'home.discover': 'Discover NAS',
    'home.scanning': 'Scanning network...',
    'home.found_devices': 'Found Devices',
    'home.no_connections': 'No connections yet. Click below to add one.',
    'home.add_connection': 'Add Connection',
    'home.edit_connection': 'Edit Connection',
    'home.name': 'Name',
    'home.url': 'URL / IP',
    'home.username': 'Username',
    'home.password': 'Password',
    'home.auth_fallback': 'Use Auth Fallback (for older WebDAV servers)',
    'home.cancel': 'Cancel',
    'home.save_changes': 'Save Changes',
    'home.save_connection': 'Save Connection',
    'home.connect': 'Connect',
    'home.connecting': 'Connecting...',
    
    // Titlebar
    'titlebar.settings': 'Settings',
    'titlebar.language': 'Language',
    
    // Browser
    'browser.locations': 'Locations',
    'browser.transfers': 'Transfers',
    'browser.search': 'Search files...',
    'browser.upload': 'Upload',
    'browser.new_folder': 'New Folder',
    'browser.loading': 'Loading directory...',
    'browser.empty': 'This folder is empty',
    'browser.no_matches': 'No matches',
    'browser.try_different': 'Try a different search term',
    'browser.no_files': 'No files or directories found',
    'browser.name': 'Name',
    'browser.size': 'Size',
    'browser.date': 'Date Modified',
    'browser.select': 'Select',
    'browser.rename': 'Rename',
    'browser.download': 'Download',
    'browser.delete': 'Delete',
    'browser.selected': 'selected',
    'browser.select_all': 'Select All',
    'browser.deselect_all': 'Deselect All',
    'browser.delete_selected': 'Delete Selected',
    'browser.delete_confirm': 'Delete {count} items?',
    'browser.delete_desc': 'Are you sure you want to permanently delete {count} selected items? This action cannot be undone.',
    'browser.delete_all': 'Delete All',
    'browser.new_folder_title': 'Create New Folder',
    'browser.folder_name': 'Folder Name',
    'browser.create': 'Create',
    'browser.rename_title': 'Rename Item',
    'browser.new_name': 'New Name',
    'browser.preview_not_available': 'Preview not available',
    'browser.preview_desc': 'This file type cannot be previewed in the browser. You can download it to open it locally.',
    'browser.download_file': 'Download File',
    'browser.disconnect': 'Disconnect',
    
    // Transfers
    'transfers.title': 'Transfers',
    'transfers.clear_finished': 'Clear finished',
    'transfers.no_transfers': 'No transfers',
    'transfers.queued': 'Queued',
    'transfers.running': 'Running',
    'transfers.paused': 'Paused',
    'transfers.done': 'Done',
    'transfers.error': 'Error',
    'transfers.canceled': 'Canceled',
  },
  zh: {
    // Home
    'home.title': '连接到存储',
    'home.subtitle': '通过 SMB 或 WebDAV 添加新的 NAS 连接以访问您的文件。',
    'home.discover': '发现 NAS',
    'home.scanning': '正在扫描网络...',
    'home.found_devices': '发现的设备',
    'home.no_connections': '暂无连接。点击下方添加一个。',
    'home.add_connection': '添加连接',
    'home.edit_connection': '编辑连接',
    'home.name': '名称',
    'home.url': 'URL / IP',
    'home.username': '用户名',
    'home.password': '密码',
    'home.auth_fallback': '使用认证回退（针对旧版 WebDAV 服务器）',
    'home.cancel': '取消',
    'home.save_changes': '保存更改',
    'home.save_connection': '保存连接',
    'home.connect': '连接',
    'home.connecting': '连接中...',
    
    // Titlebar
    'titlebar.settings': '设置',
    'titlebar.language': '语言 / Language',
    
    // Browser
    'browser.locations': '位置',
    'browser.transfers': '传输',
    'browser.search': '搜索文件...',
    'browser.upload': '上传',
    'browser.new_folder': '新建文件夹',
    'browser.loading': '正在加载目录...',
    'browser.empty': '此文件夹为空',
    'browser.no_matches': '没有匹配项',
    'browser.try_different': '尝试不同的搜索词',
    'browser.no_files': '未找到文件或目录',
    'browser.name': '名称',
    'browser.size': '大小',
    'browser.date': '修改日期',
    'browser.select': '选择',
    'browser.rename': '重命名',
    'browser.download': '下载',
    'browser.delete': '删除',
    'browser.selected': '已选择',
    'browser.select_all': '全选',
    'browser.deselect_all': '取消全选',
    'browser.delete_selected': '删除所选',
    'browser.delete_confirm': '删除 {count} 个项目？',
    'browser.delete_desc': '确定要永久删除所选的 {count} 个项目吗？此操作无法撤销。',
    'browser.delete_all': '全部删除',
    'browser.new_folder_title': '新建文件夹',
    'browser.folder_name': '文件夹名称',
    'browser.create': '创建',
    'browser.rename_title': '重命名项目',
    'browser.new_name': '新名称',
    'browser.preview_not_available': '预览不可用',
    'browser.preview_desc': '无法在浏览器中预览此文件类型。您可以下载到本地打开。',
    'browser.download_file': '下载文件',
    'browser.disconnect': '断开连接',
    
    // Transfers
    'transfers.title': '传输列表',
    'transfers.clear_finished': '清除已完成',
    'transfers.no_transfers': '暂无传输任务',
    'transfers.queued': '排队中',
    'transfers.running': '传输中',
    'transfers.paused': '已暂停',
    'transfers.done': '已完成',
    'transfers.error': '错误',
    'transfers.canceled': '已取消',
  }
};

export const useTranslation = () => {
  const language = useI18nStore((state) => state.language);
  
  const t = (key: keyof typeof translations['en'], params?: Record<string, string | number>) => {
    let str = translations[language][key] || translations['en'][key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };

  return { t, language };
};
