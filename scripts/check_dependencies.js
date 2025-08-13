/**
 * Discord.js voice 의존성 확인 스크립트
 */
const { generateDependencyReport } = require('@discordjs/voice');

console.log('🔍 Discord.js Voice 의존성 보고서:');
console.log(generateDependencyReport());

// 추가 암호화 라이브러리 확인
console.log('\n🔍 설치된 암호화 라이브러리 확인:');

const libs = ['tweetnacl', 'sodium-native', 'sodium', 'libsodium-wrappers', '@discordjs/opus', 'opusscript'];

libs.forEach(lib => {
    try {
        require(lib);
        console.log(`✅ ${lib}: 설치됨`);
    } catch (err) {
        console.log(`❌ ${lib}: 설치되지 않음 (${err.message})`);
    }
}); 