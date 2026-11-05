plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.adaptiveavatar.overlay"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.adaptiveavatar.overlay"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Friends install it directly (no store), so the release build is signed with the debug key.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    // The model, the AI engine and the clips are big and already compressed: store them as they are,
    // so the page can read them straight from the APK.
    androidResources {
        noCompress += listOf("onnx_data", "onnx", "wasm", "webm", "bin")
    }
}
