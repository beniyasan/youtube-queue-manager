interface LiveChatMessage {
  id: string
  authorDisplayName: string
  authorChannelId: string
  message: string
  publishedAt: string
}

interface YouTubeApiResponse {
  liveChatId: string | null
  messages: LiveChatMessage[]
  nextPageToken: string | null
  pollingIntervalMs: number
}

export async function getLiveChatId(videoId: string): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is not set')
  }

  const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${apiKey}`
  
  const res = await fetch(url)
  if (!res.ok) {
    console.error('Failed to fetch video details:', await res.text())
    return null
  }

  const data = await res.json()
  
  if (!data.items || data.items.length === 0) {
    return null
  }

  return data.items[0]?.liveStreamingDetails?.activeLiveChatId || null
}

export async function getLiveChatMessages(
  liveChatId: string,
  pageToken?: string
): Promise<YouTubeApiResponse> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY is not set')
  }

  let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&maxResults=200&key=${apiKey}`
  
  if (pageToken) {
    url += `&pageToken=${pageToken}`
  }

  const res = await fetch(url)
  if (!res.ok) {
    const errorText = await res.text()
    console.error('Failed to fetch live chat messages:', errorText)
    return {
      liveChatId,
      messages: [],
      nextPageToken: null,
      pollingIntervalMs: 10000,
    }
  }

  const data = await res.json()

  const messages: LiveChatMessage[] = (data.items || []).map((item: {
    id: string
    snippet: { displayMessage: string; publishedAt: string }
    authorDetails: { displayName: string; channelId: string }
  }) => ({
    id: item.id,
    authorDisplayName: item.authorDetails.displayName,
    authorChannelId: item.authorDetails.channelId,
    message: item.snippet.displayMessage,
    publishedAt: item.snippet.publishedAt,
  }))

  return {
    liveChatId,
    messages,
    nextPageToken: data.nextPageToken || null,
    pollingIntervalMs: data.pollingIntervalMillis || 10000,
  }
}

export function filterMessagesByKeyword(
  messages: LiveChatMessage[],
  keyword: string,
  lastMessageId?: string
): LiveChatMessage[] {
  let foundLast = !lastMessageId
  
  return messages.filter((msg) => {
    if (!foundLast) {
      if (msg.id === lastMessageId) {
        foundLast = true
      }
      return false
    }
    return msg.message.includes(keyword)
  })
}
