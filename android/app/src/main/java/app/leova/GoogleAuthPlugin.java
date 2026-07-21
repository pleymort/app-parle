package app.leova;

import android.os.CancellationSignal;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import java.util.concurrent.Executors;

/**
 * Connexion Google via le Credential Manager Android : renvoie un ID token
 * Google que la couche web échange contre une session Firebase (signInWithIdp),
 * en LIANT le compte anonyme (le uid — donc le plan — est conservé) ou en
 * retrouvant le compte existant de l'utilisateur (restauration).
 */
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    @PluginMethod
    public void signIn(final PluginCall call) {
        final String clientId = call.getString("clientId");
        if (clientId == null) { call.reject("clientId requis"); return; }

        GetGoogleIdOption option = new GetGoogleIdOption.Builder()
            .setServerClientId(clientId)
            .setFilterByAuthorizedAccounts(false) // propose tous les comptes de l'appareil
            .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build();

        CredentialManager cm = CredentialManager.create(getContext());
        cm.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            Executors.newSingleThreadExecutor(),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential c = response.getCredential();
                    if (c instanceof CustomCredential &&
                        GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        GoogleIdTokenCredential g =
                            GoogleIdTokenCredential.createFrom(((CustomCredential) c).getData());
                        JSObject ret = new JSObject();
                        ret.put("idToken", g.getIdToken());
                        ret.put("email", g.getId());
                        call.resolve(ret);
                    } else {
                        call.reject("credential inattendu");
                    }
                }
                @Override
                public void onError(GetCredentialException e) {
                    call.reject(e.getType() != null && e.getType().contains("CANCEL")
                        ? "annulé" : String.valueOf(e.getMessage()));
                }
            });
    }
}
