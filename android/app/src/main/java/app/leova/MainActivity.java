package app.leova;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Durcissement de la tablette dédiée.
 *
 * Le principe qui guide tout ce fichier : si la tablette s'éteint, se tait,
 * plante ou sort de l'app, l'enfant n'a plus de voix — et il ne sait pas le
 * réparer lui-même. Chaque garde-fou ci-dessous supprime un mode de panne
 * silencieux, sans demander la moindre permission supplémentaire.
 */
public class MainActivity extends BridgeActivity {

    /** Vrai quand le mode kiosk est actif : durcit l'affichage et les touches. */
    static boolean kioskHardening = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        registerPlugin(AppSettingsPlugin.class);
        registerPlugin(BillingPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);

        // L'écran ne doit pas s'éteindre pendant que l'enfant s'exprime.
        // FLAG_KEEP_SCREEN_ON ne demande AUCUNE permission (au contraire de WAKE_LOCK).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        installCrashRecovery();
    }

    /**
     * Le moteur de rendu de la WebView peut être tué par le système (mémoire).
     * Sans ce traitement, Android tue TOUTE l'application : l'enfant se
     * retrouve devant l'écran d'accueil, qu'il ne sait pas manipuler. On
     * détruit la vue morte et on relance proprement l'activité.
     */
    private void installCrashRecovery() {
        final WebView wv = getBridge().getWebView();
        wv.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                recreate();
                return true; // sans ce "true", le process de l'app est tué
            }
        });
    }

    /** Appelé par KioskPlugin à l'activation / désactivation du kiosk. */
    void applyKioskHardening(boolean on) {
        kioskHardening = on;
        runOnUiThread(() -> {
            // Fige l'orientation sur celle en cours : une rotation remet la
            // grille en page, et l'enfant perd les repères de position sur
            // lesquels repose son automatisme.
            setRequestedOrientation(on
                ? ActivityInfo.SCREEN_ORIENTATION_LOCKED
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            applyImmersive(on);
        });
    }

    /**
     * Masque les barres système en kiosk : elles restent rappelables d'un
     * glissement (seul le mode « device owner » les verrouille vraiment),
     * mais supprimer la cible visible suffit face à un enfant de 6 ans.
     */
    private void applyImmersive(boolean on) {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), !on);
        WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (c == null) return;
        if (on) {
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && kioskHardening) applyImmersive(true);
    }

    /**
     * En kiosk, les touches de volume sont neutralisées : un appui sur
     * volume- jusqu'au silence transforme l'outil en objet inerte, sans
     * aucun signal visible — le parent croit que l'application est cassée.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (kioskHardening) {
            int k = event.getKeyCode();
            if (k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_UP
                || k == KeyEvent.KEYCODE_VOLUME_MUTE) {
                return true; // consommée
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
