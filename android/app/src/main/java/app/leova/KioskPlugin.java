package app.leova;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Mode kiosk : verrouille la tablette sur l'app (Lock Task Mode).
 *
 * Sans "device owner", startLockTask() met l'app en mode ÉPINGLÉ (comme
 * l'épinglage d'écran d'Android) : barrière solide pour un enfant, sortie
 * possible en maintenant Retour + Aperçu. Si la tablette est provisionnée
 * en device owner (adb dpm set-device-owner), le même appel donne un
 * verrouillage TOTAL non contournable.
 */
@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {

    @PluginMethod
    public void enable(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("Aucune activité"); return; }
        activity.runOnUiThread(() -> {
            try {
                activity.startLockTask();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disable(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("Aucune activité"); return; }
        activity.runOnUiThread(() -> {
            try {
                activity.stopLockTask();
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void status(final PluginCall call) {
        Context ctx = getContext();
        ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
        int mode = am.getLockTaskModeState(); // 0 = aucun, 1 = verrouillé (device owner), 2 = épinglé
        JSObject ret = new JSObject();
        ret.put("active", mode != ActivityManager.LOCK_TASK_MODE_NONE);
        ret.put("mode", mode);
        call.resolve(ret);
    }
}
