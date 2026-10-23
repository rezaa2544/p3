package ir.payesh2.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/**
 * تنها اکتیویتی برنامه: پوستهٔ WebView با صفحهٔ «نشانی سرور» در نخستین اجرا.
 *
 * چرا WebView و نه یک اپ نیتیو جدا: رابط کاربری سامانه (واکنش‌گرا، RTL، فارسی، PWA) یک بار
 * ساخته شده است؛ نسخهٔ اندروید باید همان را نشان دهد تا رفتار و ظاهر یکسان بماند و
 * دوباره‌کاری و ناهم‌خوانی پیش نیاید. نشانی سرور پرسیده می‌شود چون استقرار هر مدرسه
 * متفاوت است (شبکهٔ محلی یا دامنهٔ اینترنتی) و در این نسخه هیچ نشانی‌ای هارد‌کد نمی‌شود.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "payesh";
    private static final String KEY_SERVER = "server";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView web;
    private View setupPanel;
    private EditText serverInput;
    private TextView setupError;
    private ValueCallback<Uri[]> fileCallback;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        web = findViewById(R.id.web);
        setupPanel = findViewById(R.id.setupPanel);
        serverInput = findViewById(R.id.serverUrl);
        setupError = findViewById(R.id.setupError);
        Button connect = findViewById(R.id.connectBtn);

        configureWebView();

        connect.setOnClickListener(v -> connectToServer());
        serverInput.setOnEditorActionListener((v, actionId, event) -> {
            connectToServer();
            return true;
        });

        String saved = prefs.getString(KEY_SERVER, null);
        if (saved == null || saved.isEmpty()) {
            showSetup("");
        } else {
            openServer(saved);
        }
    }

    /** تنظیمات WebView: جاوااسکریپت، حافظهٔ DOM (برای نشست و صف آفلاین)، کوکی و بارگذاری. */
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " Payesh2Android/0.1.0");
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        web.setBackgroundColor(Color.WHITE);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(view, request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // فقط خطای صفحهٔ اصلی به «حالت آفلاین» تبدیل می‌شود، نه خطای منابع فرعی
                if (request.isForMainFrame()) showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // دوربین/میکروفن در این محصول استفاده نمی‌شود
                request.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String disposition, String mime, long size) {
                try {
                    DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                    r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                    r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                            android.webkit.URLUtil.guessFileName(url, disposition, mime));
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(r);
                } catch (Exception ignored) {
                    // دانلود ناموفق نباید برنامه را ببندد
                }
            }
        });
    }

    /** پیوندهای خارج از میزبان سرور (مثل tel: یا سایت دیگر) به سیستم سپرده می‌شوند. */
    private boolean handleUrl(WebView view, Uri uri) {
        String saved = prefs.getString(KEY_SERVER, "");
        String host = Uri.parse(saved).getHost();
        if (uri.getHost() != null && uri.getHost().equalsIgnoreCase(host)) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if (scheme.equals("http") || scheme.equals("https")) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // هیچ برنامه‌ای برای این پیوند نیست
        }
        return true;
    }

    private void connectToServer() {
        String url = normalizeServerUrl(serverInput.getText().toString());
        if (url == null) {
            setupError.setText(R.string.error_bad_url);
            setupError.setVisibility(View.VISIBLE);
            return;
        }
        setupError.setVisibility(View.GONE);
        prefs.edit().putString(KEY_SERVER, url).apply();
        hideKeyboard();
        openServer(url);
    }

    private void openServer(String url) {
        setupPanel.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        web.loadUrl(url);
    }

    private void showSetup(String currentUrl) {
        web.setVisibility(View.GONE);
        setupPanel.setVisibility(View.VISIBLE);
        serverInput.setText(currentUrl);
        serverInput.requestFocus();
    }

    private void showOffline() {
        web.loadUrl("file:///android_asset/offline.html");
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(serverInput.getWindowToken(), 0);
    }

    /**
     * پاک‌سازی و اعتبارسنجی نشانی: اگر طرح (http/https) نوشته نشده باشد افزوده می‌شود؛
     * نشانی باید میزبان داشته باشد. بدون این کار، ورودی اشتباه به «جست‌وجوی گوگل» تبدیل
     * می‌شد و کاربر فکر می‌کرد برنامه خراب است.
     */
    static String normalizeServerUrl(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        Uri uri = Uri.parse(s);
        String host = uri.getHost();
        if (host == null || host.isEmpty() || !host.contains(".") && !host.equals("localhost") && !host.contains(":")) {
            return null;
        }
        return s;
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.action_change_server) {
            showSetup(prefs.getString(KEY_SERVER, ""));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.getVisibility() == View.VISIBLE && web.canGoBack()) {
            web.goBack();
            return;
        }
        if (setupPanel != null && setupPanel.getVisibility() == View.VISIBLE
                && prefs.getString(KEY_SERVER, "").length() > 0) {
            openServer(prefs.getString(KEY_SERVER, ""));
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
        }
        super.onDestroy();
    }
}
