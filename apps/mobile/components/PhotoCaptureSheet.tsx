import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { uploadPhotoForEquipment } from '@soteria/core/photoUpload'
import type { PhotoSlot } from '@soteria/core/storagePaths'

// Mobile photo capture flow. Two entry points:
//   - Take Photo → expo-image-picker.launchCameraAsync()
//   - Choose from Library → expo-image-picker.launchImageLibraryAsync()
//
// Both return a local file:// URI. We fetch() it to get a Blob and
// hand off to the shared @soteria/core/photoUpload pipeline (which
// handles the Supabase upload + photo_status reconcile dance for
// both web and mobile).
//
// expo-image-picker handles the runtime permission prompt itself —
// the strings come from app.json's plugin config.

interface Props {
  visible:     boolean
  equipmentId: string
  slot:        PhotoSlot
  onClose:     () => void
  onUploaded:  (publicUrl: string) => void
}

export default function PhotoCaptureSheet({
  visible,
  equipmentId,
  slot,
  onClose,
  onUploaded,
}: Props) {
  const { tenantId } = useTenant()
  const [busy,  setBusy]  = useState(false)
  const [phase, setPhase] = useState<'idle' | 'capturing' | 'uploading'>('idle')

  async function pickFromCamera() {
    if (busy) return
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(
        'Camera permission needed',
        'Open Settings and enable Camera for Soteria FIELD to take photos here.',
      )
      return
    }
    await runPicker(() =>
      ImagePicker.launchCameraAsync({
        mediaTypes:    'images',
        // Industrial placard photos benefit from being wide-aspect, but
        // we don't crop client-side — let the placard renderer fit it.
        quality:       0.85,
        // EXIF leaks GPS coordinates; strip on capture.
        exif:          false,
      }),
    )
  }

  async function pickFromLibrary() {
    if (busy) return
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(
        'Photo library permission needed',
        'Open Settings and enable Photos for Soteria FIELD to pick from your library.',
      )
      return
    }
    await runPicker(() =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        quality:    0.85,
        exif:       false,
      }),
    )
  }

  async function runPicker(launch: () => Promise<ImagePicker.ImagePickerResult>) {
    if (!tenantId) {
      Alert.alert('No tenant selected', 'Pick a tenant from the dashboard first.')
      return
    }
    setBusy(true)
    setPhase('capturing')
    try {
      const result = await launch()
      if (result.canceled || !result.assets[0]) return
      const uri = result.assets[0].uri
      setPhase('uploading')
      // RN's fetch on a file:// URI yields a Blob the @supabase/supabase-js
      // upload path can consume. The result.assets[0].mimeType is
      // 'image/jpeg' on both iOS and Android camera/library outputs;
      // expo-image-picker normalizes HEIC to JPEG by default.
      const response = await fetch(uri)
      const blob     = await response.blob()
      const { publicUrl } = await uploadPhotoForEquipment({
        equipmentId,
        type:     slot,
        blob,
        tenantId,
        retry:    true,
      })
      onUploaded(publicUrl)
      onClose()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      Alert.alert('Upload failed', message)
    } finally {
      setBusy(false)
      setPhase('idle')
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
      onRequestClose={busy ? undefined : onClose}
    >
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>
            {slot === 'EQUIP' ? 'Equipment photo' : 'Isolation photo'}
          </Text>

          {busy ? (
            <View style={styles.busyBox}>
              <ActivityIndicator size="large" />
              <Text style={styles.busyText}>
                {phase === 'uploading' ? 'Uploading…' : 'Opening camera…'}
              </Text>
            </View>
          ) : (
            <>
              <ActionButton label="Take Photo" onPress={pickFromCamera} primary />
              <ActionButton label="Choose from Library" onPress={pickFromLibrary} />
              <ActionButton label="Cancel" onPress={onClose} muted />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function ActionButton({
  label, onPress, primary, muted,
}: { label: string; onPress: () => void; primary?: boolean; muted?: boolean }) {
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[
          styles.btn,
          primary && styles.btnPrimary,
          muted && styles.btnMuted,
          pressed && styles.btnPressed,
        ]}>
          <Text style={[styles.btnText, primary && styles.btnTextPrimary]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  sheet:          { padding: 16, paddingBottom: 32, gap: 8, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: '#fff' },
  title:          { fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: 8, color: '#0f172a' },
  busyBox:        { padding: 24, alignItems: 'center', gap: 12 },
  busyText:       { fontSize: 14, opacity: 0.7, color: '#0f172a' },
  btn:            { paddingVertical: 14, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  btnPrimary:     { backgroundColor: '#1e3a8a', borderColor: '#1e3a8a' },
  btnMuted:       { borderColor: '#e2e8f0' },
  btnPressed:     { opacity: 0.6 },
  btnText:        { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  btnTextPrimary: { color: '#fff' },
})
