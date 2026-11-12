export { default as Avatar } from './components/Avatar.vue'
export { default as Icon } from './components/Icon.vue'
export type { IconName } from './components/Icon.vue'
export { default as AddFriendBox } from './components/AddFriendBox.vue'
export { default as ConversationItem } from './components/ConversationItem.vue'
export { default as MessageBubble } from './components/MessageBubble.vue'
export { default as MessageList } from './components/MessageList.vue'
export { default as AttachmentBubble } from './components/AttachmentBubble.vue'
export { default as ChatInput } from './components/ChatInput.vue'
export { default as AvatarCropper } from './components/AvatarCropper.vue'
export { default as FriendItem } from './components/FriendItem.vue'
export { default as MediaViewer } from './components/MediaViewer.vue'
export { default as LoginView } from './components/LoginView.vue'
export { default as ProfilePage } from './components/ProfilePage.vue'
export { default as SettingsSheet } from './components/SettingsSheet.vue'
export { default as EmptyState } from './components/EmptyState.vue'
export { useChatStore } from './stores/chat.js'
export {
  useNotifications,
  enableNotifications,
  setNotificationsEnabled,
  notifyEnabled,
  notifyPermission,
  notifySupported,
} from './notify.js'
export { initTheme, useTheme, setThemeMode, cycleThemeMode, THEME_CHROME } from './theme.js'
export type { ThemeMode, ResolvedTheme } from './theme.js'
export { default as logoUrl } from './logo.svg'
