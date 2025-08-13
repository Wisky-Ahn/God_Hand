/**
 * Discord.js voice 암호화 테스트 프로그램
 */
const { generateDependencyReport } = require('@discordjs/voice');
const { VoiceConnection } = require('@discordjs/voice');

console.log('🔍 Discord.js Voice 암호화 테스트');
console.log(generateDependencyReport());

// 암호화 라이브러리 직접 테스트
console.log('\n🔍 암호화 라이브러리 직접 테스트:');

// tweetnacl 테스트
try {
    const tweetnacl = require('tweetnacl');
    console.log('✅ tweetnacl: 정상 로드');
    
    // 간단한 암호화 테스트
    const key = new Uint8Array(32);
    const nonce = new Uint8Array(24);
    const data = new Uint8Array([1, 2, 3, 4]);
    
    const encrypted = tweetnacl.secretbox(data, nonce, key);
    console.log('✅ tweetnacl: 암호화 테스트 성공');
} catch (err) {
    console.log('❌ tweetnacl 테스트 실패:', err.message);
}

// libsodium-wrappers 테스트
try {
    const sodium = require('libsodium-wrappers');
    console.log('✅ libsodium-wrappers: 정상 로드');
    
    // ready 대기 테스트
    sodium.ready.then(() => {
        console.log('✅ libsodium-wrappers: 초기화 완료');
    }).catch(err => {
        console.log('❌ libsodium-wrappers 초기화 실패:', err.message);
    });
} catch (err) {
    console.log('❌ libsodium-wrappers 테스트 실패:', err.message);
}

// sodium-native 테스트
try {
    const sodium_native = require('sodium-native');
    console.log('✅ sodium-native: 정상 로드');
    
    // 간단한 테스트
    const key = Buffer.alloc(32);
    const nonce = Buffer.alloc(24);
    const data = Buffer.from([1, 2, 3, 4]);
    const encrypted = Buffer.alloc(data.length + 16);
    
    sodium_native.crypto_secretbox_easy(encrypted, data, nonce, key);
    console.log('✅ sodium-native: 암호화 테스트 성공');
} catch (err) {
    console.log('❌ sodium-native 테스트 실패:', err.message);
}

// 실제 voice connection에서 사용하는 암호화 모듈 찾기
console.log('\n🔍 Voice Connection 암호화 모듈:');
try {
    // Discord.js voice 내부에서 사용하는 암호화 방법 확인
    const voiceModule = require('@discordjs/voice/dist/index.js');
    console.log('Voice module keys:', Object.keys(voiceModule).filter(k => k.includes('encrypt') || k.includes('crypto')));
} catch (err) {
    console.log('❌ Voice module 분석 실패:', err.message);
} 