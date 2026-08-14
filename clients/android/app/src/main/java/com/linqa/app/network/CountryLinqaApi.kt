package com.linqa.app.network

import org.json.JSONArray
import org.json.JSONObject

data class CountryLinqaCountry(val code: String, val name: String, val callingCode: String?, val regionCode: String?)
data class CountryLinqaRegion(val code: String, val name: String, val parentCode: String?)
data class CountryLinqaPreferences(
    val mode: String,
    val verifiedCountryCode: String?,
    val verificationState: String,
    val selectedCountries: List<String>,
    val selectedRegions: List<String>,
    val locationPrecision: String,
    val showCity: Boolean,
)
data class CountryLinqaCatalog(val countries: List<CountryLinqaCountry>, val regions: List<CountryLinqaRegion>)
data class StepUpChallenge(val challengeId: String, val challenge: String, val expiresAt: String)

private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

/**
 * Ported from CountryLinqa's `apps/mobile/src/api/countryLinqa.ts`, against
 * the real server's countrylinqa route family — not the pack's standalone
 * Express service.
 */
class CountryLinqaApi(private val api: RealApiClient) {

    suspend fun catalog(): CountryLinqaCatalog {
        val response = api.get("/v1/countrylinqa/catalog")
        val countries = response.getJSONArray("countries")
        val regions = response.getJSONArray("regions")
        return CountryLinqaCatalog(
            countries = (0 until countries.length()).map { i ->
                val c = countries.getJSONObject(i)
                CountryLinqaCountry(
                    code = c.getString("code"),
                    name = c.getString("name"),
                    callingCode = c.optString("callingCode", null),
                    regionCode = c.optString("regionCode", null),
                )
            },
            regions = (0 until regions.length()).map { i ->
                val r = regions.getJSONObject(i)
                CountryLinqaRegion(
                    code = r.getString("code"),
                    name = r.getString("name"),
                    parentCode = r.optString("parentCode", null),
                )
            },
        )
    }

    suspend fun preferences(): CountryLinqaPreferences =
        parsePreferences(api.get("/v1/countrylinqa/preferences"))

    suspend fun savePreferences(
        mode: String,
        selectedCountries: List<String> = emptyList(),
        selectedRegions: List<String> = emptyList(),
        locationPrecision: String = "COUNTRY",
        showCity: Boolean = false,
    ): CountryLinqaPreferences {
        val body = JSONObject()
            .put("mode", mode)
            .put("selectedCountries", JSONArray(selectedCountries))
            .put("selectedRegions", JSONArray(selectedRegions))
            .put("locationPrecision", locationPrecision)
            .put("showCity", showCity)
        return parsePreferences(api.put("/v1/countrylinqa/preferences", body))
    }

    suspend fun confirmCountry(claimedCountryCode: String): JSONObject {
        val body = JSONObject().put("claimedCountryCode", claimedCountryCode)
        return api.post("/v1/countrylinqa/verification/confirm-country", body)
    }

    suspend fun feedScope(): JSONObject = api.get("/v1/countrylinqa/feed/scope")

    suspend fun golivefeed(cursor: String? = null): JSONObject =
        api.get("/v1/countrylinqa/golive/feed" + (cursor?.let { "?cursor=$it" } ?: ""))

    suspend fun golivebusinesses(): JSONObject = api.get("/v1/countrylinqa/golive/businesses")

    suspend fun goliveevents(): JSONObject = api.get("/v1/countrylinqa/golive/events")

    suspend fun communitiesMine(): JSONObject = api.get("/v1/countrylinqa/communities/mine")

    suspend fun joinCountryCommunity(code: String): JSONObject =
        api.post("/v1/countrylinqa/communities/country/$code/join")

    suspend fun leaveCountryCommunity(code: String): JSONObject =
        api.post("/v1/countrylinqa/communities/country/$code/leave")

    suspend fun createStepUpChallenge(purpose: String): StepUpChallenge {
        val response = api.post(
            "/v1/countrylinqa/security/stepup/challenge",
            JSONObject().put("purpose", purpose),
        )
        return StepUpChallenge(
            challengeId = response.getString("challengeId"),
            challenge = response.getString("challenge"),
            expiresAt = response.getString("expiresAt"),
        )
    }

    suspend fun consumeStepUpChallenge(challengeId: String, challenge: String, purpose: String) {
        api.post(
            "/v1/countrylinqa/security/stepup/consume",
            JSONObject().put("challengeId", challengeId).put("challenge", challenge).put("purpose", purpose),
        )
    }

    suspend fun reverify(deviceId: String, stepUpChallengeId: String, stepUpChallenge: String): JSONObject =
        api.post(
            "/v1/countrylinqa/verification/reverify",
            JSONObject()
                .put("deviceId", deviceId)
                .put("stepUpChallengeId", stepUpChallengeId)
                .put("stepUpChallenge", stepUpChallenge),
        )

    private fun parsePreferences(json: JSONObject) = CountryLinqaPreferences(
        mode = json.getString("mode"),
        verifiedCountryCode = json.optString("verifiedCountryCode", null),
        verificationState = json.optString("verificationState", "UNVERIFIED"),
        selectedCountries = json.optJSONArray("selectedCountries")?.strings() ?: emptyList(),
        selectedRegions = json.optJSONArray("selectedRegions")?.strings() ?: emptyList(),
        locationPrecision = json.optString("locationPrecision", "COUNTRY"),
        showCity = json.optBoolean("showCity", false),
    )
}
