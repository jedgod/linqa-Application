package com.linqa.app.account

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.linqa.app.network.RealApiClient
import java.util.UUID
import org.json.JSONObject

/**
 * A stable per-installation identifier for this app install on this
 * device, persisted the same way as `crypto/DeviceIdentity.kt`. Backs the
 * real multi-account vertical (`device_installations_v2` /
 * `POST /v5/installations`, server/src/services/multi-account.service.ts) —
 * that service's own comments note nothing else ever creates this row, so
 * every other multi-account endpoint was unreachable without it.
 */
class InstallationIdentity(context: Context) {
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "linqa-installation-identity",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun publicId(): String {
        prefs.getString(KEY_PUBLIC_ID, null)?.let { return it }
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_PUBLIC_ID, generated).apply()
        return generated
    }

    /** Registers this installation with the server on first call (or if not
     * yet cached); returns the server-side installation id on every call. */
    suspend fun ensureRegistered(api: RealApiClient): String {
        prefs.getString(KEY_INSTALLATION_ID, null)?.let { return it }

        val response = api.post(
            "/v5/installations",
            JSONObject().put("installationPublicId", publicId()).put("platform", "ANDROID"),
        )
        val installationId = response.getString("id")
        prefs.edit().putString(KEY_INSTALLATION_ID, installationId).apply()
        return installationId
    }

    companion object {
        private const val KEY_PUBLIC_ID = "installation_public_id"
        private const val KEY_INSTALLATION_ID = "installation_id"
    }
}
