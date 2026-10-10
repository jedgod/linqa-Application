package com.linqa.mobile.messaging

import android.database.sqlite.SQLiteDatabase
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray

// Core implementations MUST operate only on supplied serialized state.
// No mutate-then-rollback wrapping of your existing open() is allowed.
interface StagedCore {
 data class Prepared(val plaintext: ByteArray, val nextState: ByteArray)
 fun prepareOpen(scope: InboxScope, envelope: ByteArray, state: ByteArray?): Prepared
 fun validatePayload(plaintext: ByteArray)
}
data class InboxScope(val accountId: String, val deviceId: String, val conversationId: String) {
 init { require(listOf(accountId,deviceId,conversationId).all { it.isNotBlank() }) }
 fun encoded(): String = JSONArray(listOf(accountId,deviceId,conversationId)).toString()
}
class InboxFailure(val code: String): Exception(code)
interface SessionAuthority {
 // Must check authenticated account, installation binding, membership and lock state.
 // This guard must serialize lock/revoke with access until the operation completes.
 fun <T> withAuthorizedScope(scope: InboxScope, operation: () -> T): T
}
class AndroidAead(private val alias: String) {
 private fun key(): SecretKey {
  val ks=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  val existing=ks.getKey(alias,null)
  if(existing is SecretKey) return existing
  val generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
  generator.init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
   .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
   .setKeySize(256).setRandomizedEncryptionRequired(true).build())
  return generator.generateKey()
 }
 @Synchronized fun seal(value: ByteArray,aad: String): ByteArray {
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
  cipher.updateAAD(aad.toByteArray(Charsets.UTF_8));return cipher.iv+cipher.doFinal(value)
 }
 @Synchronized fun open(value: ByteArray,aad: String): ByteArray {
  if(value.size<28)throw InboxFailure("LOCAL_STORAGE_CORRUPT")
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,value.copyOfRange(0,12)))
  cipher.updateAAD(aad.toByteArray(Charsets.UTF_8));return cipher.doFinal(value.copyOfRange(12,value.size))
 }
 fun destroy() { KeyStore.getInstance("AndroidKeyStore").apply {load(null);deleteEntry(alias)} }
}
class DurableInbox(private val db: SQLiteDatabase, private val core: StagedCore,
 private val authority: SessionAuthority, private val aead: AndroidAead) {
 init {
  // Open app-private database; caller must configure WAL and synchronous FULL
  // before constructing, outside any transaction. Exclude DB/WAL/SHM from backup.
  db.execSQL("CREATE TABLE IF NOT EXISTS receive_state(scope TEXT PRIMARY KEY, sealed BLOB NOT NULL)")
  db.execSQL("CREATE TABLE IF NOT EXISTS receive_inbox(scope TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,sealed BLOB NOT NULL,PRIMARY KEY(scope,id))")
  db.execSQL("CREATE TABLE IF NOT EXISTS receive_receipts(scope TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(scope,id))")
 }
 private fun aad(scope:String,id:String,digest:String)=JSONArray(listOf(scope,id,digest,1)).toString()
 @Synchronized fun readOrOpenAndCommit(scope:InboxScope,id:String,envelope:ByteArray):String = authority.withAuthorizedScope(scope) {
  require(id.isNotBlank());if(envelope.isEmpty()||envelope.size>65536)throw InboxFailure("INVALID_ENVELOPE")
  val sk=scope.encoded();val stateKey=JSONArray(listOf(scope.accountId,scope.deviceId)).toString();val hash=MessageDigest.getInstance("SHA-256").digest(envelope).joinToString(""){"%02x".format(it.toInt() and 255)}
  var text:ByteArray?=null;var state:ByteArray?=null;var staged:StagedCore.Prepared?=null
  db.beginTransaction()
  try {
   db.rawQuery("SELECT digest,sealed FROM receive_inbox WHERE scope=? AND id=?",arrayOf(sk,id)).use { c ->
    if(c.moveToFirst()) {
     if(c.getString(0)!=hash)throw InboxFailure("ENVELOPE_CHANGED")
     text=aead.open(c.getBlob(1),aad(sk,id,hash))
    }
   }
   if(text==null) {
    db.rawQuery("SELECT sealed FROM receive_state WHERE scope=?",arrayOf(stateKey)).use {c->if(c.moveToFirst())state=aead.open(c.getBlob(0),aad(stateKey,"state","v1"))}
    staged=core.prepareOpen(scope,envelope,state)
    core.validatePayload(staged!!.plaintext)
    text=staged!!.plaintext
    db.execSQL("INSERT INTO receive_inbox(scope,id,digest,sealed) VALUES(?,?,?,?)",arrayOf(sk,id,hash,aead.seal(text!!,aad(sk,id,hash))))
    db.execSQL("INSERT OR REPLACE INTO receive_state(scope,sealed) VALUES(?,?)",arrayOf(stateKey,aead.seal(staged!!.nextState,aad(stateKey,"state","v1"))))
   }
   db.setTransactionSuccessful()
  } finally {db.endTransaction();state?.fill(0);staged?.nextState?.fill(0)}
  // Return only after endTransaction has committed. JS must still check its epoch.
  try {text!!.toString(Charsets.UTF_8)} finally {text?.fill(0)}
 }
 @Synchronized fun recordDisplayed(scope:InboxScope,ids:List<String>)=authority.withAuthorizedScope(scope) {
  require(ids.size<=100);val sk=scope.encoded();db.beginTransaction()
  try {for(id in ids) {
   db.rawQuery("SELECT 1 FROM receive_inbox WHERE scope=? AND id=?",arrayOf(sk,id)).use {c->if(!c.moveToFirst())throw InboxFailure("MESSAGE_NOT_OPENED")}
   db.execSQL("INSERT OR IGNORE INTO receive_receipts VALUES(?,?)",arrayOf(sk,id))
  };db.setTransactionSuccessful()}finally{db.endTransaction()}
 }
 @Synchronized fun pendingReceipts(scope:InboxScope,limit:Int):List<String> = authority.withAuthorizedScope(scope) {
  require(limit in 1..100);val result=mutableListOf<String>()
  db.rawQuery("SELECT id FROM receive_receipts WHERE scope=? ORDER BY id LIMIT ?",arrayOf(scope.encoded(),limit.toString())).use {c->while(c.moveToNext())result.add(c.getString(0))};result
 }
 @Synchronized fun ackReceipts(scope:InboxScope,ids:List<String>)=authority.withAuthorizedScope(scope) {
  require(ids.size<=100);db.beginTransaction();try{for(id in ids)db.execSQL("DELETE FROM receive_receipts WHERE scope=? AND id=?",arrayOf(scope.encoded(),id));db.setTransactionSuccessful()}finally{db.endTransaction()}
 }
}
