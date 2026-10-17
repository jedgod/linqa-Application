package com.yourapp;

import android.app.Activity;
import android.content.Intent;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import io.microblink.activity.BlinkCardActivity;
import io.microblink.entities.recognizers.RecognizerBundle;
import io.microblink.entities.recognizers.blinkcard.BlinkCardRecognizer;
import io.microblink.entities.recognizers.blinkcard.BlinkCardRecognizerResult;

public class BlinkCardModule extends ReactContextBaseJavaModule implements ActivityEventListener {

    private static final int BLINK_CARD_REQUEST_CODE = 1234;
    private Promise scanPromise;
    private ReactApplicationContext reactContext;

    public BlinkCardModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        reactContext.addActivityEventListener(this);
    }

    @NonNull
    @Override
    public String getName() {
        return "BlinkCardModule";
    }

    @ReactMethod
    public void startScan(Promise promise) {
        Activity currentActivity = getCurrentActivity();
        if (currentActivity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null");
            return;
        }
        this.scanPromise = promise;

        try {
            BlinkCardRecognizer blinkCardRecognizer = new BlinkCardRecognizer();
            RecognizerBundle recognizerBundle = new RecognizerBundle(blinkCardRecognizer);

            Intent intent = new Intent(currentActivity, BlinkCardActivity.class);
            intent.putExtra(BlinkCardActivity.EXTRAS_RECOGNIZER_BUNDLE, recognizerBundle);
            intent.putExtra(BlinkCardActivity.EXTRAS_LICENSE_KEY, "YOUR_BLINKCARD_LICENSE_KEY");

            currentActivity.startActivityForResult(intent, BLINK_CARD_REQUEST_CODE);
        } catch (Exception e) {
            promise.reject("SCAN_ERROR", e.getMessage());
        }
    }

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, @Nullable Intent data) {
        if (requestCode != BLINK_CARD_REQUEST_CODE) {
            return;
        }

        if (scanPromise == null) {
            return;
        }

        if (resultCode == Activity.RESULT_OK && data != null) {
            RecognizerBundle recognizerBundle = data.getParcelableExtra(BlinkCardActivity.EXTRAS_RECOGNIZER_BUNDLE);
            if (recognizerBundle == null) {
                scanPromise.reject("NO_RESULT", "No recognizer bundle returned");
                scanPromise = null;
                return;
            }

            BlinkCardRecognizer blinkCardRecognizer = (BlinkCardRecognizer) recognizerBundle.getRecognizers()[0];
            BlinkCardRecognizerResult result = blinkCardRecognizer.getResult();

            if (result.getResultState() == BlinkCardRecognizerResult.State.Valid) {
                // Prepare data to send back to JS
                String cardNumber = result.getCardNumber();
                String cardHolderName = result.getOwner();
                String expiryDate = String.format("%02d/%02d", result.getExpiryMonth(), result.getExpiryYear() % 100);

                // CVV is NOT scanned for PCI compliance; user must enter manually

                // Send result as map
                WritableMap map = Arguments.createMap();
                map.putString("cardNumber", cardNumber);
                map.putString("cardHolderName", cardHolderName);
                map.putString("expiryDate", expiryDate);

                scanPromise.resolve(map);
            } else {
                scanPromise.reject("INVALID_RESULT", "Scan result invalid");
            }
        } else if (resultCode == Activity.RESULT_CANCELED) {
            scanPromise.reject("CANCELED", "User canceled scan");
        } else {
            scanPromise.reject("UNKNOWN_ERROR", "Unknown error during scan");
        }

        scanPromise = null;
    }

    @Override
    public void onNewIntent(Intent intent) {
        // Not used
    }
}
