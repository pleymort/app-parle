package app.leova;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Collections;
import java.util.List;

/**
 * Abonnement « Leova Plus » via Google Play Billing.
 *
 * Le plugin ne fait QUE le dialogue d'achat : la validation (et le passage
 * du compte en plan "plus") se fait côté serveur, qui vérifie le
 * purchaseToken auprès de l'API Google Play — jamais sur parole du client.
 * Sans Play Store (installation USB), les appels échouent proprement et
 * l'app reste en formule gratuite.
 */
@CapacitorPlugin(name = "Billing")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {

    private BillingClient client;
    private PluginCall pendingBuy;

    private void withClient(PluginCall call, Runnable onReady) {
        if (client != null && client.isReady()) { onReady.run(); return; }
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) onReady.run();
                else call.reject("Google Play indisponible (" + r.getResponseCode() + ")");
            }
            @Override
            public void onBillingServiceDisconnected() { }
        });
    }

    @PluginMethod
    public void buy(final PluginCall call) {
        final String productId = call.getString("productId");
        if (productId == null) { call.reject("productId requis"); return; }
        withClient(call, () -> {
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()))
                .build();
            client.queryProductDetailsAsync(params, (r, details) -> {
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK || details.isEmpty()) {
                    call.reject("abonnement introuvable sur Google Play (" + r.getResponseCode() + ")");
                    return;
                }
                ProductDetails pd = details.get(0);
                if (pd.getSubscriptionOfferDetails() == null || pd.getSubscriptionOfferDetails().isEmpty()) {
                    call.reject("aucune offre d'abonnement configurée");
                    return;
                }
                String offerToken = pd.getSubscriptionOfferDetails().get(0).getOfferToken();
                BillingFlowParams flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(pd)
                            .setOfferToken(offerToken)
                            .build()))
                    .build();
                call.setKeepAlive(true);
                pendingBuy = call;
                getActivity().runOnUiThread(() -> client.launchBillingFlow(getActivity(), flow));
            });
        });
    }

    // Résultat du dialogue d'achat Google Play.
    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        PluginCall call = pendingBuy;
        pendingBuy = null;
        if (call == null) return;
        if (r.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("achat annulé");
            return;
        }
        if (r.getResponseCode() != BillingClient.BillingResponseCode.OK
                || purchases == null || purchases.isEmpty()) {
            call.reject("achat impossible (" + r.getResponseCode() + ")");
            return;
        }
        Purchase p = purchases.get(0);
        JSObject ret = new JSObject();
        ret.put("purchaseToken", p.getPurchaseToken());
        ret.put("productId", p.getProducts().isEmpty() ? "" : p.getProducts().get(0));
        call.resolve(ret);
    }

    // Abonnements actifs du compte Google (réinstallation, nouvelle tablette).
    @PluginMethod
    public void restore(final PluginCall call) {
        withClient(call, () -> client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (r, purchases) -> {
                JSArray list = new JSArray();
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    for (Purchase p : purchases) {
                        JSObject o = new JSObject();
                        o.put("purchaseToken", p.getPurchaseToken());
                        o.put("productId", p.getProducts().isEmpty() ? "" : p.getProducts().get(0));
                        list.put(o);
                    }
                }
                JSObject ret = new JSObject();
                ret.put("purchases", list);
                call.resolve(ret);
            }));
    }
}
