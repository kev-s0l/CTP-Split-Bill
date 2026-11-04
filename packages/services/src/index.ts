// Re-exports the service adapters: queue (background jobs), storage (blobs),
// notify (live database events) and sms (phone verification codes). Import from @project/services, never from the SDK directly.
// Boilerplate — generic queue helpers (enqueue, encode/decode). Example branches
// add typed helpers (enqueueItemCreated, enqueueThumbnail).
export { queueClient, enqueue, type JobMessage, encodeJobMessage, decodeJobMessage } from "./queue";
export {
  uploadAttachment,
  downloadAttachment,
  storageAvailable,
  safeBlobName,
  MAX_ATTACHMENT_BYTES,
} from "./storage";
export { stagePayload, onStage } from "./notify";
export { sendSms } from "./sms";