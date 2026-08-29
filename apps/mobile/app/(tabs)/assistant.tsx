import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View as RNView,
  Text as RNText,
} from 'react-native'
import FontAwesome from '@expo/vector-icons/FontAwesome'

import { Text, View } from '@/components/Themed'
import Colors from '@/constants/Colors'
import { useColorScheme } from '@/components/useColorScheme'
import { useTenant } from '@/components/TenantProvider'
import { sendAssistantMessage, dedupeCitations, type AssistantCitation } from '@/lib/assistant'

// /assistant — mobile safety assistant. A single chat thread per session:
// the first send creates a conversation, subsequent sends continue it. The
// server (POST /api/assistant/chat) owns the model, tools, and RAG; this
// screen is the messaging UI + citation list. Conversation history across
// sessions is a follow-up (the web's conversation list isn't surfaced here
// yet).

interface ChatMessage {
  id:         string
  role:       'user' | 'assistant'
  text:       string
  citations?: AssistantCitation[]
}

export default function AssistantScreen() {
  const { tenant } = useTenant()
  const scheme = useColorScheme() ?? 'light'
  const tint   = Colors[scheme].tint

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input,    setInput]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const conversationId = useRef<string | null>(null)
  const scrollRef      = useRef<ScrollView>(null)

  const canSend = input.trim().length > 0 && !sending && !!tenant?.id

  const scrollToEnd = () =>
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))

  async function onSend() {
    const text = input.trim()
    if (!text || !tenant?.id || sending) return
    setError(null)
    setInput('')
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', text }])
    setSending(true)
    scrollToEnd()
    try {
      const reply = await sendAssistantMessage({
        tenantId:       tenant.id,
        message:        text,
        conversationId: conversationId.current,
      })
      conversationId.current = reply.conversationId
      setMessages(prev => [...prev, {
        id:        reply.messageId ?? `a-${Date.now()}`,
        role:      'assistant',
        text:      reply.reply,
        citations: reply.citations,
      }])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSending(false)
      scrollToEnd()
    }
  }

  const assistantBubbleBg = scheme === 'dark' ? '#1e293b' : '#f1f5f9'
  const assistantTextCol  = scheme === 'dark' ? '#e2e8f0' : '#0f172a'

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <RNView style={styles.empty}>
              <FontAwesome name="comments-o" size={42} color={tint} />
              <Text style={styles.emptyTitle}>Ask the safety assistant</Text>
              <Text style={styles.emptyBody}>
                LOTO procedures, SDS details, regulations, your company policies — answered from your
                organization&apos;s data and cited back to the source.
              </Text>
            </RNView>
          )}

          {messages.map(m => {
            const isUser = m.role === 'user'
            const sources = m.citations ? dedupeCitations(m.citations) : []
            return (
              <RNView
                key={m.id}
                style={[
                  styles.bubble,
                  isUser
                    ? [styles.userBubble, { backgroundColor: tint }]
                    : [styles.assistantBubble, { backgroundColor: assistantBubbleBg }],
                ]}
              >
                <RNText style={[styles.bubbleText, { color: isUser ? '#ffffff' : assistantTextCol }]}>
                  {m.text}
                </RNText>
                {sources.length > 0 && (
                  <RNView style={styles.citations}>
                    {sources.map((c, i) => (
                      <Pressable
                        key={`${c.document_id}-${i}`}
                        onPress={() => { if (c.source_url) void Linking.openURL(c.source_url) }}
                        disabled={!c.source_url}
                        hitSlop={6}
                      >
                        <RNText style={[styles.citation, { color: tint }]} numberOfLines={1}>
                          <FontAwesome name="file-text-o" size={11} color={tint} />  {c.title}
                        </RNText>
                      </Pressable>
                    ))}
                  </RNView>
                )}
              </RNView>
            )
          })}

          {sending && (
            <RNView style={[styles.bubble, styles.assistantBubble, { backgroundColor: assistantBubbleBg }]}>
              <ActivityIndicator color={tint} />
            </RNView>
          )}
        </ScrollView>

        {error && <Text style={styles.error}>{error}</Text>}

        <RNView style={[styles.inputBar, { borderTopColor: scheme === 'dark' ? '#1e293b' : '#e2e8f0' }]}>
          <TextInput
            style={[styles.input, {
              color:           assistantTextCol,
              backgroundColor: scheme === 'dark' ? '#0f172a' : '#ffffff',
              borderColor:     scheme === 'dark' ? '#334155' : '#cbd5e1',
            }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask a safety question…"
            placeholderTextColor="#94a3b8"
            multiline
            editable={!sending}
          />
          <Pressable
            onPress={() => void onSend()}
            disabled={!canSend}
            style={[styles.sendBtn, { backgroundColor: canSend ? tint : '#cbd5e1' }]}
          >
            <FontAwesome name="send" size={16} color="#ffffff" />
          </Pressable>
        </RNView>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex:   { flex: 1 },
  scroll: { padding: 12, gap: 10, flexGrow: 1 },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyBody:  { fontSize: 14, opacity: 0.6, textAlign: 'center', lineHeight: 20 },
  bubble:          { maxWidth: '88%', borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13 },
  userBubble:      { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText:      { fontSize: 15, lineHeight: 21 },
  citations:       { marginTop: 8, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1', paddingTop: 6 },
  citation:        { fontSize: 12 },
  error:           { color: '#dc2626', fontSize: 13, paddingHorizontal: 14, paddingBottom: 6 },
  inputBar:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input:           { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  sendBtn:         { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
})
