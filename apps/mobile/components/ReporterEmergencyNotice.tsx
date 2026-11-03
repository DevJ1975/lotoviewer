import { StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { REPORTER_EMERGENCY_NOTICE } from '@soteria/core/reporterGuidance'

// "Get help first" notice for every screen a worker can file a report from.
// Reporting is asynchronous, so the screen itself has to say what to do when
// the event is live. English only: the mobile app has no locale switch yet.
export default function ReporterEmergencyNotice() {
  const { heading, body } = REPORTER_EMERGENCY_NOTICE.en
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box:     { padding: 12, borderRadius: 10, borderWidth: 2, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  heading: { color: '#7F1D1D', fontSize: 14, fontWeight: '700' },
  body:    { color: '#7F1D1D', fontSize: 13, marginTop: 2 },
})
