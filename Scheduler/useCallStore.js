import { defineStore } from 'pinia';
import axios from 'axios';
import AgoraRTC from 'agora-rtc-sdk-ng'; // Run: npm install agora-rtc-sdk-ng

const api = axios.create({
  baseURL: 'https://linqa-app.com',
  headers: { 'Content-Type': 'application/json' }
});

export const useCallStore = defineStore('callStore', {
  state: () => ({
    scheduledCalls: [],
    toasts: [], // Holds active array notifications [{ id, message, type, callId }]
    loading: false,
    error: null,
    pollTimer: null,
    
    // Agora Engine Core WebRTC State
    rtcClient: null,
    localTracks: { videoTrack: null, audioTrack: null },
    remoteUsers: [],
    currentRoomId: null
  }),

  actions: {
    // ---- TOAST & NOTIFICATION SYSTEM ----
    addToast(message, type = 'info', callId = null) {
      const id = Date.now() + Math.random().toString(36).substr(2, 5);
      this.toasts.push({ id, message, type, callId });
      
      // Auto-dismiss notification banner after 8 seconds
      setTimeout(() => {
        this.dismissToast(id);
      }, 8000);
    },

    dismissToast(id) {
      this.toasts = this.toasts.filter(t => t.id !== id);
    },

    // Poller or WebSocket heartbeat wrapper checking if standard items are ready to join
    checkUpcomingCallWindows() {
      const now = new Date();
      this.scheduledCalls.forEach(call => {
        const scheduledTime = new Date(call.scheduled_at);
        const timeDiffMins = (scheduledTime - now) / 60000;

        // Trigger unique Alert Toast if it's 5 minutes or less before the call starts
        if (timeDiffMins <= 5 && timeDiffMins > -15 && !call.notified) {
          call.notified = true; // Prevent duplicate banners
          this.addToast(
            `Your call with ${call.host_name} is ready to join!`, 
            'success', 
            call.id
          );
        }
      });
    },

    // ---- AGORA WEBRTC ENGINE ARCHITECTURE INTEGRATION ----
    async initAgoraEngine(appId, roomId, token, uid = null) {
      if (this.rtcClient) await this.leaveAgoraSession();
      this.currentRoomId = roomId;
      
      // Initialize client instance profile parameter configuration
      this.rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

      // Handle event listener connections for inbound remote streams
      this.rtcClient.on('user-published', async (user, mediaType) => {
        await this.rtcClient.subscribe(user, mediaType);
        if (mediaType === 'video' && !this.remoteUsers.find(u => u.uid === user.uid)) {
          this.remoteUsers.push(user);
        }
        if (mediaType === 'audio') {
          user.audioTrack.play();
        }
      });

      this.rtcClient.on('user-unpublished', (user) => {
        this.remoteUsers = this.remoteUsers.filter(u => u.uid !== user.uid);
      });

      // Join standard channel configuration profile target channel
      await this.rtcClient.join(appId, roomId, token, uid);

      // Create and publish local camera + mic hardware streams
      const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
      this.localTracks.audioTrack = audioTrack;
      this.localTracks.videoTrack = videoTrack;

      await this.rtcClient.publish([audioTrack, videoTrack]);
    },

    async leaveAgoraSession() {
      // Safely close physical input items down cleanly
      if (this.localTracks.audioTrack) {
        this.localTracks.audioTrack.stop();
        this.localTracks.audioTrack.close();
      }
      if (this.localTracks.videoTrack) {
        this.localTracks.videoTrack.stop();
        this.localTracks.videoTrack.close();
      }
      
      if (this.rtcClient) {
        await this.rtcClient.leave();
        this.rtcClient = null;
      }
      
      // Clean baseline state
      this.localTracks = { videoTrack: null, audioTrack: null };
      this.remoteUsers = [];
      this.currentRoomId = null;
    },

    // Re-check the join window every 30 s so the "ready to join" toast and the Join button open on time.
    startWindowPolling() {
      this.stopWindowPolling();
      this.pollTimer = setInterval(() => this.checkUpcomingCallWindows(), 30000);
    },

    stopWindowPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    },

    // ---- AXIOS HTTP DISPATCH ACTIONS ----
    async fetchScheduledCalls() {
      this.loading = true;
      this.error = null;
      try {
        const response = await api.get('/calls/scheduled');
        const known = new Set(this.scheduledCalls.filter(c => c.notified).map(c => c.id));
        this.scheduledCalls = response.data
          .map(c => ({ ...c, notified: known.has(c.id) }))
          .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        this.checkUpcomingCallWindows();
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    // Creates a call. Expects the API to answer with the new call: { id, host_name, scheduled_at }.
    async scheduleNewCall({ scheduledAt, hostName }) {
      this.error = null;
      if (!scheduledAt || new Date(scheduledAt) <= new Date()) {
        this.error = 'Choose a time in the future.';
        this.addToast(this.error, 'error');
        throw new Error(this.error);
      }
      try {
        const response = await api.post('/calls/scheduled', { scheduled_at: scheduledAt, host_name: hostName });
        const call = { ...response.data, notified: false };
        this.scheduledCalls = [...this.scheduledCalls, call].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        this.addToast('Call scheduled.', 'success');
        this.checkUpcomingCallWindows();
        return call;
      } catch (err) {
        this.error = err.message;
        this.addToast('Could not schedule the call. Try again.', 'error');
        throw err;
      }
    },

    async cancelScheduledCall(callId) {
      try {
        await api.post(`/calls/${callId}/cancel`);
        this.scheduledCalls = this.scheduledCalls.filter(c => c.id !== callId);
      } catch (err) {
        this.error = err.message;
        this.addToast('Could not cancel the call.', 'error');
        throw err;
      }
    },

    async joinCallSession(callId) {
      try {
        const response = await api.post(`/calls/${callId}/join`);
        this.scheduledCalls = this.scheduledCalls.filter(c => c.id !== callId);
        return response.data; // { appId, roomId, roomToken }
      } catch (err) {
        this.addToast('Connection handshake authentication configuration error.', 'error');
        throw err;
      }
    }
  }
});