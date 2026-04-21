/* global window */

window.YTD.direct_message.part0 = [
  {
    "dmConversation": {
      "conversationId": "123",
      "messages": [
        {
          "messageCreate": {
            "id": "1001",
            "senderId": "42",
            "recipientId": "84",
            "createdAt": "2026-04-19T10:00:00.000Z",
            "text": "Hello from X/Twitter fixture."
          }
        },
        {
          "messageCreate": {
            "id": "1002",
            "senderId": "84",
            "recipientId": "42",
            "createdAt": "2026-04-19T10:01:00.000Z",
            "text": "Photo attached.",
            "mediaUrls": ["https://example.invalid/photo.jpg"]
          }
        },
        {
          "joinConversation": {
            "createdAt": "2026-04-19T10:02:00.000Z",
            "text": "System: someone joined"
          }
        }
      ]
    }
  }
];
