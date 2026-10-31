<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import IconifyIcon from '#/components/IconifyIcon.vue';

import {
  cloudVoiceAvailable,
  listReminderVoices,
  notificationPermission,
  playCloudVoice,
  playReminderNow,
  prepareCloudVoice,
  requestNotificationPermission,
  sortReminderVoices,
  speakReminder,
} from './focus-reminder-engine';
import {
  CLOUD_VOICE_OPTIONS,
  DEFAULT_FOCUS_REMINDER,
  loadReminderPrefs,
  REMINDER_SOUND_OPTIONS,
  REMINDER_TEXT_MAX,
  saveReminderPrefs,
  type FocusReminderPrefs,
} from './focus-reminder-prefs';

const QUICK_TEXTS = [
  '专注完成啦，起来喝口水吧～',
  '该休息一下眼睛了，看看远处～',
  '这一轮很棒，伸个懒腰再出发～',
];

const open = ref(false);
const prefs = ref<FocusReminderPrefs>(loadReminderPrefs());
const voices = ref<SpeechSynthesisVoice[]>([]);
const notifyInput = ref<HTMLInputElement | null>(null);
const notifyState = ref<NotificationPermission | 'unsupported'>(
  notificationPermission(),
);
const notifyHint = ref('');
const previewing = ref(false);
const previewHint = ref('');

const cloudAvailable = cloudVoiceAvailable();

const useCloudVoice = computed(
  () => cloudAvailable && prefs.value.voiceSource === 'cloud',
);

const voiceLabel = computed(() => {
  if (useCloudVoice.value) {
    const option = CLOUD_VOICE_OPTIONS.find(
      (item) => item.value === prefs.value.cloudVoice,
    );
    return option ? option.label : '云端自然音色';
  }
  if (!voices.value.length) return '系统默认音色';
  const current = voices.value.find((voice) => voice.voiceURI === prefs.value.voiceURI);
  if (!current) return '系统默认音色';
  return `${current.name}（${current.lang}）`;
});

const notifyLabel = computed(() => {
  if (notifyState.value === 'granted') return '已授权';
  if (notifyState.value === 'denied') return '浏览器已拒绝';
  if (notifyState.value === 'unsupported') return '当前浏览器不支持';
  return '点击开启';
});

watch(
  prefs,
  (value) => {
    saveReminderPrefs(value);
  },
  { deep: true },
);

async function refreshVoices() {
  voices.value = sortReminderVoices(await listReminderVoices());
}

function toggle() {
  open.value = !open.value;
  if (open.value) {
    notifyState.value = notificationPermission();
    void refreshVoices();
    // 打开面板就先把当前云端音色合成好：等点「试听」时通常已经能直接播。
    if (useCloudVoice.value && prefs.value.text.trim()) {
      void prepareCloudVoice(prefs.value.text, prefs.value);
    }
  }
}

function close() {
  open.value = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation();
    close();
  }
}

function useQuickText(text: string) {
  prefs.value.text = text;
}

async function toggleNotification() {
  if (prefs.value.useNotification) {
    prefs.value.useNotification = false;
    notifyHint.value = '';
    return;
  }
  const granted = await requestNotificationPermission();
  notifyState.value = notificationPermission();
  if (granted) {
    prefs.value.useNotification = true;
    notifyHint.value = '已开启，切到别的页面也能收到提醒';
  } else {
    prefs.value.useNotification = false;
    notifyHint.value =
      notifyState.value === 'denied' ? '浏览器已拒绝通知权限' : '暂时无法开启通知';
  }
  // 权限未通过时把开关拨回去，避免界面显示与实际状态不符。
  if (notifyInput.value) notifyInput.value.checked = prefs.value.useNotification;
}

async function preview() {
  if (previewing.value) return;
  playReminderNow(prefs.value.sound);
  if (!prefs.value.useVoice || !prefs.value.text.trim()) return;
  if (useCloudVoice.value) {
    if (playCloudVoice(prefs.value.text, prefs.value)) return;
    // 首次合成要等云端，按钮锁住并说明在做什么，别再悄悄换成浏览器音色。
    previewing.value = true;
    previewHint.value = '正在合成云端音色，第一次会慢一些…';
    try {
      const ready = await prepareCloudVoice(prefs.value.text, prefs.value);
      if (ready && playCloudVoice(prefs.value.text, prefs.value)) {
        previewHint.value = '';
        return;
      }
      previewHint.value = '云端音色暂时合成不出来，这次先用浏览器语音';
    } finally {
      previewing.value = false;
    }
  }
  speakReminder(prefs.value.text, prefs.value);
}

function reset() {
  prefs.value = { ...DEFAULT_FOCUS_REMINDER };
  notifyHint.value = '';
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  void refreshVoices();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="reminder-control">
    <button
      type="button"
      class="reminder-btn"
      :class="{ active: open, muted: !prefs.enabled }"
      :aria-label="prefs.enabled ? '专注结束提醒设置' : '专注结束提醒已关闭'"
      :title="prefs.enabled ? '专注结束提醒' : '专注结束提醒已关闭'"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @click="toggle"
    >
      <IconifyIcon :icon="prefs.enabled ? 'lucide:bell' : 'lucide:bell-off'" />
    </button>

    <div v-if="open" class="reminder-backdrop" @click="close" />

    <section
      v-if="open"
      class="reminder-panel"
      role="dialog"
      aria-label="专注结束提醒设置"
    >
      <header class="reminder-head">
        <div>
          <p class="reminder-eyebrow">REMINDER</p>
          <h2>专注结束提醒</h2>
        </div>
        <button
          type="button"
          class="reminder-close"
          aria-label="关闭提醒设置"
          @click="close"
        >
          <IconifyIcon icon="lucide:x" />
        </button>
      </header>

      <label class="reminder-row">
        <span class="reminder-label">提醒总开关</span>
        <input
          v-model="prefs.enabled"
          type="checkbox"
          class="reminder-switch"
          aria-label="提醒总开关"
        />
      </label>

      <div class="reminder-block" :class="{ disabled: !prefs.enabled }">
        <label class="reminder-row">
          <span class="reminder-label">语音播报</span>
          <input
            v-model="prefs.useVoice"
            type="checkbox"
            class="reminder-switch"
            aria-label="语音播报"
          />
        </label>

        <label class="reminder-field">
          <span class="reminder-label">提示文字</span>
          <textarea
            v-model="prefs.text"
            class="reminder-textarea"
            rows="2"
            :maxlength="REMINDER_TEXT_MAX"
            placeholder="想对自己说什么？"
          />
        </label>
        <div class="reminder-quick">
          <button
            v-for="item in QUICK_TEXTS"
            :key="item"
            type="button"
            class="reminder-chip"
            @click="useQuickText(item)"
          >
            {{ item }}
          </button>
        </div>

        <label v-if="cloudAvailable" class="reminder-field">
          <span class="reminder-label">音色来源</span>
          <select v-model="prefs.voiceSource" class="reminder-select">
            <option value="cloud">云端自然音色</option>
            <option value="browser">浏览器语音</option>
          </select>
        </label>

        <label v-if="useCloudVoice" class="reminder-field">
          <span class="reminder-label">音色</span>
          <select v-model="prefs.cloudVoice" class="reminder-select">
            <option
              v-for="option in CLOUD_VOICE_OPTIONS"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </label>

        <label v-else class="reminder-field">
          <span class="reminder-label">音色</span>
          <select v-model="prefs.voiceURI" class="reminder-select">
            <option value="">系统默认音色</option>
            <option
              v-for="voice in voices"
              :key="voice.voiceURI"
              :value="voice.voiceURI"
            >
              {{ voice.name }}（{{ voice.lang }}）
            </option>
          </select>
        </label>

        <label class="reminder-field">
          <span class="reminder-label">
            语速
            <em>{{ prefs.rate.toFixed(1) }}×</em>
          </span>
          <input
            v-model.number="prefs.rate"
            type="range"
            class="reminder-range"
            min="0.6"
            max="1.6"
            step="0.1"
            aria-label="语速"
          />
        </label>
      </div>

      <label class="reminder-field">
        <span class="reminder-label">提示音</span>
        <select v-model="prefs.sound" class="reminder-select">
          <option
            v-for="option in REMINDER_SOUND_OPTIONS"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="reminder-row">
        <span class="reminder-label">
          系统通知
          <em>{{ notifyLabel }}</em>
        </span>
        <input
          ref="notifyInput"
          type="checkbox"
          class="reminder-switch"
          :checked="prefs.useNotification"
          aria-label="系统通知"
          @change="toggleNotification"
        />
      </label>
      <p v-if="notifyHint" class="reminder-hint">{{ notifyHint }}</p>

      <div class="reminder-actions">
        <button type="button" class="reminder-ghost" @click="reset">恢复默认</button>
        <button
          type="button"
          class="reminder-primary"
          :disabled="previewing"
          @click="preview"
        >
          {{ previewing ? '合成中…' : '试听' }}
        </button>
      </div>
      <p v-if="previewHint" class="reminder-hint">{{ previewHint }}</p>
      <p class="reminder-tip">
        提示音与语音会在页面切到后台时照常响起，音色：{{ voiceLabel }}。
      </p>
    </section>
  </div>
</template>

<style scoped>
.reminder-control {
  position: relative;
  display: flex;
  align-items: center;
}

.reminder-btn {
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 10px;
  color: rgb(255 255 255 / 0.65);
  background: rgb(15 23 20 / 0.55);
  cursor: pointer;
  transition: all 0.18s ease;
}

.reminder-btn:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.08);
}

.reminder-btn.active {
  color: var(--study-room-primary);
  border-color: color-mix(in srgb, var(--study-room-primary) 40%, transparent);
}

.reminder-btn.muted {
  color: rgb(255 255 255 / 0.35);
}

.reminder-backdrop {
  position: fixed;
  z-index: 60;
  inset: 0;
  background: rgb(0 0 0 / 0.18);
}

.reminder-panel {
  position: absolute;
  z-index: 70;
  top: calc(100% + 10px);
  right: 0;
  width: min(340px, calc(100vw - 32px));
  max-height: calc(100dvh - 140px);
  overflow-y: auto;
  padding: 16px 18px 18px;
  border: 1px solid color-mix(in srgb, var(--study-room-primary, #d7ef83) 22%, transparent);
  border-radius: 20px;
  background: color-mix(
    in srgb,
    var(--study-room-secondary, #5ab8b0) 10%,
    rgb(9 17 14 / 0.94)
  );
  box-shadow: 0 24px 70px rgb(0 0 0 / 0.48);
  color: #fff;
  backdrop-filter: blur(24px);
}

.reminder-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
}

.reminder-eyebrow {
  margin: 0 0 4px;
  color: var(--study-room-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
}

.reminder-head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.reminder-close {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: rgb(255 255 255 / 0.55);
  background: rgb(255 255 255 / 0.06);
  cursor: pointer;
}

.reminder-close:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.12);
}

.reminder-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.reminder-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 13px;
  color: rgb(255 255 255 / 0.78);
}

.reminder-label em {
  font-style: normal;
  font-size: 12px;
  color: var(--study-room-primary);
}

/* 自绘开关，贴合自习室暗色主题 */
.reminder-switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  appearance: none;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.08);
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease;
}

.reminder-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.6);
  transition: transform 0.18s ease, background 0.18s ease;
}

.reminder-switch:checked {
  border-color: transparent;
  background: var(--study-room-primary);
}

.reminder-switch:checked::after {
  background: #051612;
  transform: translateX(18px);
}

.reminder-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0 12px;
}

.reminder-block.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.reminder-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reminder-textarea,
.reminder-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 10px;
  color: #fff;
  background: rgb(0 0 0 / 0.24);
  font-size: 13px;
  font-family: inherit;
}

.reminder-textarea {
  resize: vertical;
  line-height: 1.6;
}

.reminder-select option {
  color: #0b1511;
}

.reminder-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.reminder-chip {
  padding: 5px 10px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 999px;
  color: rgb(255 255 255 / 0.68);
  background: rgb(255 255 255 / 0.05);
  cursor: pointer;
  font-size: 11px;
}

.reminder-chip:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.1);
}

.reminder-range {
  width: 100%;
  accent-color: var(--study-room-primary);
}

.reminder-hint {
  margin: 2px 0 0;
  font-size: 12px;
  color: rgb(255 255 255 / 0.55);
}

.reminder-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

.reminder-ghost,
.reminder-primary {
  flex: 1;
  padding: 9px 0;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.reminder-ghost {
  border: 1px solid rgb(255 255 255 / 0.16);
  color: rgb(255 255 255 / 0.7);
  background: transparent;
}

.reminder-primary {
  border: 0;
  color: #051612;
  background: var(--study-room-primary);
}

.reminder-tip {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: rgb(255 255 255 / 0.45);
}

@media (max-width: 720px) {
  /* 窄屏时改为贴边固定，避免面板从按钮左侧溢出屏幕。 */
  .reminder-panel {
    position: fixed;
    top: 58px;
    right: 12px;
    left: 12px;
    width: auto;
    max-height: calc(100dvh - 76px);
  }
}
</style>
