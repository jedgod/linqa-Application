package com.linqa.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val accessTokenExpiresAtMillis: Long,
    val userId: String,
    val subject: String,
    val deviceId: String?,
)

/**
 * Device-bound session storage backed by Android Keystore-wrapped
 * EncryptedSharedPreferences. Nothing about auth in this app existed before
 * this — there was previously no token storage of any kind, only a static
 * `x-linqa-demo-user: galaxy` header.
 */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "linqa-session-store",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun save(session: StoredSession) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, session.accessToken)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .putLong(KEY_ACCESS_EXPIRES_AT, session.accessTokenExpiresAtMillis)
            .putString(KEY_USER_ID, session.userId)
            .putString(KEY_SUBJECT, session.subject)
            .apply {
                if (session.deviceId != null) putString(KEY_DEVICE_ID, session.deviceId)
            }
            .apply()
    }

    fun updateAccessToken(accessToken: String, expiresAtMillis: Long, refreshToken: String) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putLong(KEY_ACCESS_EXPIRES_AT, expiresAtMillis)
            .apply()
    }

    fun current(): StoredSession? {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return null
        val userId = prefs.getString(KEY_USER_ID, null) ?: return null
        val subject = prefs.getString(KEY_SUBJECT, null) ?: return null
        return StoredSession(
            accessToken = accessToken,
            refreshToken = refreshToken,
            accessTokenExpiresAtMillis = prefs.getLong(KEY_ACCESS_EXPIRES_AT, 0L),
            userId = userId,
            subject = subject,
            deviceId = prefs.getString(KEY_DEVICE_ID, null),
        )
    }

    fun isEnrolled(): Boolean = current()?.deviceId != null

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_ACCESS_EXPIRES_AT = "access_token_expires_at"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_SUBJECT = "subject"
        private const val KEY_DEVICE_ID = "device_id"
    }
}
