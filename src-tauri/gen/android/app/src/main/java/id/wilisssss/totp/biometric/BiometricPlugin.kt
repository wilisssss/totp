package id.wilisssss.totp.biometric

import android.app.Activity
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Fingerprint unlock for the vault.
 *
 * The Rust side hands over the vault master key; this plugin seals it with an
 * Android Keystore key created with `setUserAuthenticationRequired(true)`, so
 * the OS refuses to use the key outside a `BiometricPrompt` CryptoObject. The
 * fingerprint check is therefore enforced by the keystore, not by this code.
 *
 * The ciphertext lives in SharedPreferences. Adding or removing a fingerprint
 * invalidates the key (`setInvalidatedByBiometricEnrollment`), which makes the
 * sealed key undecryptable — the user then re-enrols with the passphrase.
 */
private const val KEY_ALIAS = "totp-biometric-v1"
private const val PREFS = "totp-biometric"
private const val PREF_IV = "iv"
private const val PREF_DATA = "data"
private const val TITLE = "Buka vault TOTP"
private const val SUBTITLE = "Gunakan sidik jari untuk membuka vault"

@InvokeArg
class EnrollArgs {
    /** Base64 of the 32 byte vault master key. */
    lateinit var secret: String
}

@TauriPlugin
class BiometricPlugin(private val activity: Activity) : Plugin(activity) {
    private enum class Mode { ENROLL, UNLOCK }

    private var pendingInvoke: Invoke? = null
    private var pendingMode: Mode? = null
    private var pendingPlain: ByteArray? = null

    private fun prefs() = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun hasStoredSecret(): Boolean =
        prefs().getString(PREF_DATA, null) != null && keyStore().containsAlias(KEY_ALIAS)

    private fun secretKey(): SecretKey {
        val store = keyStore()
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 seconds = authenticate for every single use of the key.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            spec.setUserAuthenticationValidityDurationSeconds(-1)
        }

        generator.init(spec.build())
        return generator.generateKey()
    }

    private fun encryptCipher(): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.ENCRYPT_MODE, secretKey())
        }

    private fun decryptCipher(iv: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        }

    private fun biometricAvailable(): Boolean =
        BiometricManager.from(activity)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS

    private fun resetPending() {
        pendingInvoke = null
        pendingMode = null
        pendingPlain = null
    }

    private fun clearStoredSecret() {
        prefs().edit().remove(PREF_IV).remove(PREF_DATA).apply()
        try {
            keyStore().deleteEntry(KEY_ALIAS)
        } catch (_: Exception) {
            // Nothing to delete — the alias may already be gone.
        }
    }

    private fun showPrompt(cipher: Cipher, mode: Mode, invoke: Invoke, plain: ByteArray?) {
        pendingInvoke = invoke
        pendingMode = mode
        pendingPlain = plain

        val prompt = BiometricPrompt(
            activity as FragmentActivity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    val target = pendingInvoke
                    val current = pendingMode
                    val secret = pendingPlain
                    val authenticated = result.cryptoObject?.cipher
                    resetPending()

                    if (target == null || current == null || authenticated == null) {
                        target?.reject("Sesi biometrik tidak valid", "biometric_failed")
                        secret?.fill(0)
                        return
                    }

                    try {
                        if (current == Mode.ENROLL) {
                            val sealed = authenticated.doFinal(secret ?: ByteArray(0))
                            prefs()
                                .edit()
                                .putString(PREF_IV, encode(authenticated.iv))
                                .putString(PREF_DATA, encode(sealed))
                                .apply()
                            val reply = JSObject()
                            reply.put("enrolled", true)
                            target.resolve(reply)
                        } else {
                            val stored = prefs().getString(PREF_DATA, null)
                            if (stored == null) {
                                target.reject("Sidik jari belum diaktifkan", "not_enrolled")
                                return
                            }
                            val plaintext = authenticated.doFinal(decode(stored))
                            val reply = JSObject()
                            reply.put("secret", String(plaintext, Charsets.UTF_8))
                            plaintext.fill(0)
                            target.resolve(reply)
                        }
                    } catch (error: Exception) {
                        target.reject(
                            error.message ?: "Operasi biometrik gagal",
                            "biometric_failed",
                            error,
                        )
                    } finally {
                        secret?.fill(0)
                    }
                }

                override fun onAuthenticationError(code: Int, message: CharSequence) {
                    val target = pendingInvoke
                    val secret = pendingPlain
                    resetPending()
                    secret?.fill(0)

                    val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED ||
                        code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        code == BiometricPrompt.ERROR_CANCELED
                    if (cancelled) {
                        target?.reject("Dibatalkan", "cancelled")
                    } else {
                        target?.reject(message.toString(), "biometric_failed")
                    }
                }

                override fun onAuthenticationFailed() {
                    // A finger did not match; the prompt stays open so the user
                    // can try again. No reply yet.
                }
            },
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(TITLE)
            .setSubtitle(SUBTITLE)
            .setNegativeButtonText("Batal")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    @Command
    fun status(invoke: Invoke) {
        val available = biometricAvailable()
        val reply = JSObject()
        reply.put("available", available)
        reply.put("enrolled", available && hasStoredSecret())
        invoke.resolve(reply)
    }

    @Command
    fun enroll(invoke: Invoke) {
        val args = invoke.parseArgs(EnrollArgs::class.java)

        if (pendingInvoke != null) {
            invoke.reject("Prompt biometrik masih berjalan", "busy")
            return
        }
        if (!biometricAvailable()) {
            invoke.reject("Perangkat tidak punya sidik jari yang terdaftar", "unavailable")
            return
        }

        val cipher = try {
            encryptCipher()
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Gagal menyiapkan kunci", "biometric_failed", error)
            return
        }

        showPrompt(cipher, Mode.ENROLL, invoke, decode(args.secret))
    }

    @Command
    fun unlock(invoke: Invoke) {
        if (pendingInvoke != null) {
            invoke.reject("Prompt biometrik masih berjalan", "busy")
            return
        }
        if (!hasStoredSecret()) {
            invoke.reject("Sidik jari belum diaktifkan", "not_enrolled")
            return
        }

        val iv = prefs().getString(PREF_IV, null)
        if (iv == null) {
            clearStoredSecret()
            invoke.reject("Data sidik jari rusak — aktifkan ulang", "invalidated")
            return
        }

        val cipher = try {
            decryptCipher(decode(iv))
        } catch (error: KeyPermanentlyInvalidatedException) {
            clearStoredSecret()
            invoke.reject("Sidik jari berubah — aktifkan ulang di Pengaturan", "invalidated")
            return
        } catch (error: Exception) {
            invoke.reject(error.message ?: "Gagal membuka kunci", "biometric_failed", error)
            return
        }

        showPrompt(cipher, Mode.UNLOCK, invoke, null)
    }

    @Command
    fun disable(invoke: Invoke) {
        clearStoredSecret()
        invoke.resolve()
    }
}
