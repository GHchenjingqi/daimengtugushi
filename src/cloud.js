// 云端客户端初始化。publicConfig 来自本应用「古诗词知识库」的云服务激活结果，
// endpoint 与 publishableKey 均为可安全内置于前端的值（不含任何密钥）。
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

export const publicConfig = {
  endpoint: 'https://gushici.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_ifzrwwVkZlqehs0a235jsy_BWYPbZDKmAxmgADQ2zLbEE37k56JO7sX'
}

export const cloud = createWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  oauthRelayBaseUrl: publicConfig.oauthRelayBaseUrl,
  publishableKey: publicConfig.publishableKey
})
