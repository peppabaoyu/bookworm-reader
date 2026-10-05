package com.dionysus.bookworm;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> filePathCallback;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingVoice = "";
    private float pendingRate = 1.0f;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private static final int FILE_REQ = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                if (url.startsWith("file://") || url.startsWith("data:") || url.startsWith("blob:")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {}
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "选择书籍文件"), FILE_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.addJavascriptInterface(new TTSBridge(), "AndroidTTS");
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.loadUrl("file:///android_asset/app/index.html");
        setContentView(web);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ && filePathCallback != null) {
            Uri[] results = null;
            if (data != null && data.getData() != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else {
                    results = new Uri[]{ data.getData() };
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        super.onDestroy();
    }

    private void js(String code) {
        ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); });
    }

    /* ---------- 原生语音桥: 供渲染层 window.AndroidTTS 调用 ---------- */
    class TTSBridge {
        private void ensureInit() {
            if (tts != null) return;
            tts = new TextToSpeech(getApplicationContext(), status -> {
                ttsReady = (status == TextToSpeech.SUCCESS);
                if (ttsReady) {
                    try { tts.setLanguage(Locale.US); } catch (Exception ignored) {}
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) {}
                        @Override public void onDone(String utteranceId) {
                            js("window.__ttsEvent && window.__ttsEvent('end','" + utteranceId + "')");
                        }
                        @Override public void onError(String utteranceId) {
                            js("window.__ttsEvent && window.__ttsEvent('end','" + utteranceId + "')");
                        }
                    });
                    if (!pendingVoice.isEmpty()) applyVoice(pendingVoice);
                }
            });
        }

        private void applyVoice(String voiceName) {
            if (tts == null) return;
            try {
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getName().equals(voiceName)) { tts.setVoice(v); return; }
                    }
                }
            } catch (Exception ignored) {}
            String lower = voiceName == null ? "" : voiceName.toLowerCase();
            tts.setLanguage(lower.contains("gb") ? Locale.UK : Locale.US);
        }

        @JavascriptInterface
        public String getVoices() {
            ensureInit();
            // TTS 引擎异步初始化, 未就绪时返回空数组, 渲染层会重试
            if (!ttsReady || tts == null) return "[]";
            try {
                JSONArray arr = new JSONArray();
                Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        JSONObject o = new JSONObject();
                        o.put("name", v.getName());
                        o.put("lang", v.getLocale().toString());
                        arr.put(o);
                    }
                }
                return arr.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public boolean speak(String utteranceId, String text, String voiceName, double rate) {
            ensureInit();
            if (tts == null) return false;
            if (!ttsReady) {
                pendingVoice = voiceName == null ? "" : voiceName;
                pendingRate = (float) rate;
                return false;
            }
            if (voiceName != null && !voiceName.isEmpty()) applyVoice(voiceName);
            try { tts.setSpeechRate((float) rate); } catch (Exception ignored) {}
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
            return true;
        }

        @JavascriptInterface
        public void stop() {
            if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
        }
    }

    /* ---------- 通用桥: 导出文件保存到下载目录 ---------- */
    class Bridge {
        @JavascriptInterface
        public void downloadFile(String name, String content) {
            String safe = (name == null ? "笔记.md" : name).replaceAll("[\\\\/:*?\"<>|]", "_");
            byte[] bytes = content == null ? new byte[0] : content.getBytes();
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "text/markdown");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri != null) {
                        try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                            os.write(bytes);
                        }
                    }
                } else {
                    File dir = new File(getExternalFilesDir(null), "导出");
                    if (!dir.exists()) dir.mkdirs();
                    try (FileOutputStream fo = new FileOutputStream(new File(dir, safe))) {
                        fo.write(bytes);
                    }
                }
                ui.post(() -> Toast.makeText(MainActivity.this, "已导出: " + safe, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                ui.post(() -> Toast.makeText(MainActivity.this, "导出失败: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void toast(String msg) {
            ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public String readAsset(String path) {
            try {
                java.io.InputStream is = getAssets().open(path);
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = is.read(buf)) > 0) bo.write(buf, 0, n);
                is.close();
                return bo.toString("UTF-8");
            } catch (Exception e) {
                return null;
            }
        }
    }
}
