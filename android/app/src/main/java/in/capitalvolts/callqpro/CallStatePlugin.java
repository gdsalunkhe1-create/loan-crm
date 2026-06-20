package in.capitalvolts.callqpro;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.annotation.RequiresApi;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CallState",
    permissions = {
        @Permission(
            alias = "phoneState",
            strings = { Manifest.permission.READ_PHONE_STATE }
        )
    }
)
public class CallStatePlugin extends Plugin {

    private static final String TAG       = "CallStatePlugin";
    private static final String EVENT     = "callStateChanged";

    private TelephonyManager   telephonyManager;
    private CallStateCallback  modernCallback;   // API 31+
    private PhoneStateListener legacyListener;   // API 24-30

    // ─── public JS methods ───────────────────────────────────────────────────

    @PluginMethod
    public void startListening(PluginCall call) {
        if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("phoneState", call, "onPermissionResult");
            return;
        }
        doStartListening(call);
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        doStopListening();
        call.resolve();
    }

    // ─── permission callback ─────────────────────────────────────────────────

    @PermissionCallback
    private void onPermissionResult(PluginCall call) {
        if (ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.READ_PHONE_STATE)
                == PackageManager.PERMISSION_GRANTED) {
            doStartListening(call);
        } else {
            call.reject("READ_PHONE_STATE permission denied — grant Phone permission in device settings");
        }
    }

    // ─── internal helpers ────────────────────────────────────────────────────

    private void doStartListening(PluginCall call) {
        telephonyManager = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
        if (telephonyManager == null) {
            call.reject("TelephonyManager not available");
            return;
        }

        doStopListening(); // unregister any previous registration cleanly

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            registerModernCallback();
        } else {
            registerLegacyListener();
        }
        Log.i(TAG, "startListening OK, API=" + Build.VERSION.SDK_INT);
        call.resolve();
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    private void registerModernCallback() {
        modernCallback = new CallStateCallback();
        // ContextCompat.getMainExecutor is safe even when Activity is in background
        telephonyManager.registerTelephonyCallback(
            ContextCompat.getMainExecutor(getContext()),
            modernCallback
        );
        Log.i(TAG, "TelephonyCallback registered (API 31+)");
    }

    @SuppressWarnings("deprecation")
    private void registerLegacyListener() {
        legacyListener = new PhoneStateListener() {
            @Override
            public void onCallStateChanged(int state, String phoneNumber) {
                notifyCallState(state);
            }
        };
        telephonyManager.listen(legacyListener, PhoneStateListener.LISTEN_CALL_STATE);
        Log.i(TAG, "PhoneStateListener registered (API <31)");
    }

    private void doStopListening() {
        if (telephonyManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && modernCallback != null) {
            telephonyManager.unregisterTelephonyCallback(modernCallback);
            modernCallback = null;
        }
        if (legacyListener != null) {
            //noinspection deprecation
            telephonyManager.listen(legacyListener, PhoneStateListener.LISTEN_NONE);
            legacyListener = null;
        }
    }

    private void notifyCallState(int state) {
        String name;
        switch (state) {
            case TelephonyManager.CALL_STATE_RINGING:  name = "RINGING";  break;
            case TelephonyManager.CALL_STATE_OFFHOOK:  name = "OFFHOOK";  break;
            default:                                   name = "IDLE";      break;
        }
        Log.i(TAG, "callStateChanged → " + name);
        JSObject payload = new JSObject();
        payload.put("state", name);
        notifyListeners(EVENT, payload);
    }

    // ─── TelephonyCallback inner class (API 31+) ─────────────────────────────

    @RequiresApi(api = Build.VERSION_CODES.S)
    private class CallStateCallback extends TelephonyCallback
            implements TelephonyCallback.CallStateListener {
        @Override
        public void onCallStateChanged(int state) {
            notifyCallState(state);
        }
    }

    // ─── lifecycle ───────────────────────────────────────────────────────────

    @Override
    protected void handleOnDestroy() {
        doStopListening();
    }
}
