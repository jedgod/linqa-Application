// UI shell with mock data — see crypto/CoreBridge.kt. `linqa-core` (native,
// via UniFFI) is not linked yet; real dependency + NDK wiring is commented
// below for when the core is buildable.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.linqa.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.linqa.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.2.0-dev"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            // BouncyCastle and a transitive dependency (jspecify, pulled in
            // via OkHttp/Compose) both ship the same multi-release-JAR OSGi
            // manifest fragment; neither is used at runtime, so drop both.
            excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"
        }
    }

    buildTypes {
        debug {
            // 2026-08-08 fix: HUB_BASE_URL was hardcoded to :8088 while
            // API_BASE_URL was :8080 — but `registerMobileHubRoutes` (server/
            // src/routes/mobile-hub.ts) mounts the dev/mobile-hub surface on
            // the exact same Fastify `app` as every other route
            // (server/src/bootstrap/register-all.ts), so there is only ever
            // one real listening port (server/src/config/ports.ts, default
            // 8080). The two constants must always agree; the split let the
            // conversation list silently fail closed ("Live service
            // unavailable") whenever only one of the two ports was forwarded
            // via `adb reverse`.
            // Reached via `adb reverse tcp:8080 tcp:8080` on a physical device.
            // The device-side loopback must stay on 127.0.0.1, not 10.0.2.2.
            buildConfigField("String", "HUB_BASE_URL", "\"http://127.0.0.1:8080\"")
            buildConfigField("String", "API_BASE_URL", "\"http://127.0.0.1:8080\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "HUB_BASE_URL", "\"\"")
            buildConfigField("String", "API_BASE_URL", "\"\"")
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.02"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.80")
    implementation("io.getstream:stream-webrtc-android:1.3.8")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-tooling-preview")

    // Required by the UniFFI-generated linqa-core Kotlin bindings
    // (core/generated/kotlin/uniffi/linqa_core/linqa_core.kt uses com.sun.jna.*).
    implementation("net.java.dev.jna:jna:5.14.0@aar")

    // certification/uniffi-jna: reflection-only binding-surface test
    // (NativeBindingSurfaceTest) — never invokes the native library, so a
    // plain JVM unit-test runner is enough, no emulator/device required.
    testImplementation("junit:junit:4.13.2")

    // certification/uniffi-jna: IdentityImportBoundaryInstrumentationTest
    // needs a real device/emulator (loads liblinqa_core.so via JNA), so it
    // runs under androidx.test rather than the plain JVM unit-test runner.
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
