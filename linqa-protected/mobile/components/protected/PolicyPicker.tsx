// Lets the sender choose one of the three protection modes and its settings.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Eye, Timer, ShieldAlert } from 'lucide-react-native';
import { COLORS as C } from '../../constants/theme';
import { OptionRow, Section, SwitchRow } from '../ui/Rows';
import {
  DEFAULT_POLICIES,
  LIMITS,
  MODE_INFO,
  type ProtectionMode,
  type ProtectionPolicy,
} from '../../lib/protectedMedia/policy';

type Props = { value: ProtectionPolicy; onChange: (p: ProtectionPolicy) => void };

const MODES: { mode: ProtectionMode; Icon: typeof Eye }[] = [
  { mode: 'MULTI_VIEW', Icon: Eye },
  { mode: 'TIMED', Icon: Timer },
  { mode: 'EPHEMERAL', Icon: ShieldAlert },
];

export function PolicyPicker({ value, onChange }: Props) {
  return (
    <View style={{ gap: 20 }}>
      <View style={styles.modes} accessibilityRole="radiogroup">
        {MODES.map(({ mode, Icon }) => {
          const on = value.mode === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => onChange(DEFAULT_POLICIES[mode])}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={[styles.modeCard, on && styles.modeOn]}
            >
              <Icon size={22} color={on ? C.accent : C.muted} strokeWidth={1.8} />
              <Text style={[styles.modeTitle, on && { color: C.accent }]}>{MODE_INFO[mode].title}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.blurb}>{MODE_INFO[value.mode].blurb}</Text>

      {value.mode === 'MULTI_VIEW' && (
        <>
          <Section title="Number of views">
            <View style={styles.stepper}>
              <StepBtn
                label="−"
                a11y="Fewer views"
                disabled={value.maxViews <= LIMITS.MULTI_VIEW.minViews}
                onPress={() => onChange({ ...value, maxViews: value.maxViews - 1 })}
              />
              <Text style={styles.stepValue} accessibilityLiveRegion="polite">
                {value.maxViews} {value.maxViews === 1 ? 'view' : 'views'}
              </Text>
              <StepBtn
                label="+"
                a11y="More views"
                disabled={value.maxViews >= LIMITS.MULTI_VIEW.maxViews}
                onPress={() => onChange({ ...value, maxViews: value.maxViews + 1 })}
              />
            </View>
          </Section>
          <Section title="Each view lasts">
            {LIMITS.MULTI_VIEW.viewSecondOptions.map((s, i, arr) => (
              <OptionRow
                key={s}
                label={`${s} seconds`}
                selected={value.viewSeconds === s}
                onPress={() => onChange({ ...value, viewSeconds: s })}
                last={i === arr.length - 1}
              />
            ))}
          </Section>
          <Section footer="Every view is logged with the time and who opened it, whether or not you get notified.">
            <SwitchRow
              label="Notify me when viewed"
              value={value.notifyOnView}
              onValueChange={(v) => onChange({ ...value, notifyOnView: v })}
            />
          </Section>
        </>
      )}

      {value.mode === 'TIMED' && (
        <>
          <Section title="Time window">
            {LIMITS.TIMED.windowOptions.map((s, i, arr) => (
              <OptionRow
                key={s}
                label={s === 60 ? '1 minute' : `${s} seconds`}
                selected={value.windowSeconds === s}
                onPress={() => onChange({ ...value, windowSeconds: s })}
                last={i === arr.length - 1}
              />
            ))}
          </Section>
          <Section title="Clock starts">
            <OptionRow
              label="When they first open it"
              selected={value.expiryStart === 'ON_FIRST_VIEW'}
              onPress={() => onChange({ ...value, expiryStart: 'ON_FIRST_VIEW' })}
            />
            <OptionRow
              label="As soon as I send it"
              selected={value.expiryStart === 'ON_SEND'}
              onPress={() => onChange({ ...value, expiryStart: 'ON_SEND' })}
              last
            />
          </Section>
          <Section>
            <SwitchRow
              label="Notify me when viewed"
              value={value.notifyOnView}
              onValueChange={(v) => onChange({ ...value, notifyOnView: v })}
            />
          </Section>
        </>
      )}

      {value.mode === 'EPHEMERAL' && (
        <>
          <Section title="Views">
            {LIMITS.EPHEMERAL.viewOptions.map((n, i, arr) => (
              <OptionRow
                key={n}
                label={n === 1 ? 'Once' : 'Twice'}
                selected={value.maxViews === n}
                onPress={() => onChange({ ...value, maxViews: n })}
                last={i === arr.length - 1}
              />
            ))}
          </Section>
          <Section
            title="Each view lasts"
            footer="Screenshots and recordings are blocked while it is open. If one is attempted, access ends immediately and you are alerted."
          >
            {LIMITS.EPHEMERAL.viewSecondOptions.map((s, i, arr) => (
              <OptionRow
                key={s}
                label={`${s} seconds`}
                selected={value.viewSeconds === s}
                onPress={() => onChange({ ...value, viewSeconds: s })}
                last={i === arr.length - 1}
              />
            ))}
          </Section>
        </>
      )}
    </View>
  );
}

function StepBtn({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepBtn, disabled && { opacity: 0.35 }, pressed && { backgroundColor: C.pressed }]}
    >
      <Text style={styles.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 8 },
  modeCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 76,
  },
  modeOn: { borderColor: C.accent, backgroundColor: '#EEF2FD' },
  modeTitle: { fontSize: 13, fontWeight: '600', color: C.text, textAlign: 'center' },
  blurb: { fontSize: 14, lineHeight: 20, color: C.muted, paddingHorizontal: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 8 },
  stepBtn: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { fontSize: 24, color: C.accent, fontWeight: '600' },
  stepValue: { fontSize: 17, fontWeight: '600', color: C.text },
});
