package com.linqa.app.network

import com.linqa.app.auth.SessionStore
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class ApiException(val status: Int, val errorCode: String?, message: String) : IOException(message)

/**
 * Real, authenticated HTTP client for the actual API (JWT bearer auth,
 * device-bound scopes) — distinct from `crypto/CoreBridge.kt`, which only
 * ever talks to the unauthenticated dev/mobile-hub demo surface via a
 * static header. Handles access-token refresh transparently.
 */
class RealApiClient(
    private val baseUrl: String,
    private val sessions: SessionStore,
) {
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json".toMediaType()

    suspend fun postUnauthenticated(path: String, body: JSONObject): JSONObject =
        execute(buildRequest(path, "POST", body, authenticated = false))

    suspend fun get(path: String): JSONObject =
        request(path, "GET", null)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        request(path, "POST", body)

    suspend fun put(path: String, body: JSONObject): JSONObject =
        request(path, "PUT", body)

    suspend fun delete(path: String): JSONObject =
        request(path, "DELETE", null)

    private suspend fun request(path: String, method: String, body: JSONObject?): JSONObject {
        val firstAttempt = runCatching {
            execute(buildRequest(path, method, body, authenticated = true))
        }

        val error = firstAttempt.exceptionOrNull()
        if (error is ApiException && error.status == 401) {
            refreshAccessToken()
            return execute(buildRequest(path, method, body, authenticated = true))
        }

        return firstAttempt.getOrThrow()
    }

    private suspend fun refreshAccessToken() = withContext(Dispatchers.IO) {
        val session = sessions.current() ?: throw ApiException(401, "no_session", "No session to refresh.")
        val response = execute(
            buildRequest(
                "/v1/auth/sessions/refresh",
                "POST",
                JSONObject().put("refreshToken", session.refreshToken),
                authenticated = false,
            )
        )
        val expiresAtMillis =
            System.currentTimeMillis() + response.getInt("accessTokenExpiresIn") * 1000L
        sessions.updateAccessToken(
            accessToken = response.getString("accessToken"),
            expiresAtMillis = expiresAtMillis,
            refreshToken = response.getString("refreshToken"),
        )
    }

    private fun buildRequest(
        path: String,
        method: String,
        body: JSONObject?,
        authenticated: Boolean,
    ): Request {
        val builder = Request.Builder().url("$baseUrl$path")
        if (authenticated) {
            val token = sessions.current()?.accessToken
                ?: throw ApiException(401, "no_session", "Not authenticated.")
            builder.header("authorization", "Bearer $token")
        }
        when (method) {
            "GET" -> builder.get()
            "DELETE" -> if (body != null) {
                builder.delete(body.toString().toRequestBody(jsonMediaType))
            } else {
                builder.delete()
            }
            else -> builder.method(
                method,
                (body ?: JSONObject()).toString().toRequestBody(jsonMediaType),
            )
        }
        return builder.build()
    }

    private suspend fun execute(request: Request): JSONObject = withContext(Dispatchers.IO) {
        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                val errorBody = runCatching { JSONObject(raw) }.getOrNull()
                throw ApiException(
                    response.code,
                    errorBody?.optString("error"),
                    errorBody?.optString("error") ?: "Request failed (${response.code}).",
                )
            }
            if (raw.isBlank()) JSONObject() else JSONObject(raw)
        }
    }
}
