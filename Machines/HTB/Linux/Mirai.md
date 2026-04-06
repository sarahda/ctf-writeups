# HTB - Mirai

## 머신 정보

|항목|내용|
|---|---|
|이름|Mirai|
|난이도|Easy|
|OS|Linux (Raspberry Pi OS)|
|IP|10.129.191.205|
|주요 취약점|Raspberry Pi 기본 크레덴셜|
|Privesc|sudo NOPASSWD ALL|
|특이사항|삭제된 파일 복구 (Digital Forensics)|
|태그|`DefaultCredentials` `RaspberryPi` `Pi-hole` `Forensics` `sudo` `Linux`|

---

## 공격 흐름 요약

```
nmap 포트 스캔
→ 80 포트 (Pi-hole)
→ Raspberry Pi 기본 크레덴셜 (pi:raspberry)
→ SSH 접속
→ sudo NOPASSWD ALL → root
→ USB 스틱에서 삭제된 flag 복구
```

---

## 1. 정찰 (Reconnaissance)

### 1.1 Nmap 포트 스캔

```bash
nmap -p- --min-rate 10000 -T4 10.129.191.205
```

**결과:**

|PORT|SERVICE|
|---|---|
|22/tcp|SSH|
|53/tcp|domain (dnsmasq)|
|80/tcp|HTTP|
|1919/tcp|can-dch|
|32400/tcp|plex|
|32469/tcp|unknown|

### 1.2 서비스 확인

```bash
nmap -sV -p 53,80 10.129.191.205
```

- 포트 53 → **dnsmasq** (Raspberry Pi 경량 DNS 서버)
- 포트 80 → **Pi-hole** 광고 차단 서버

### 1.3 HTTP 헤더 확인

```bash
curl -I http://10.129.191.205/
```

특이한 헤더 발견:

```
X-Pi-hole: A black hole for Internet advertisements.
```

### 1.4 Pi-hole 대시보드

```
http://10.129.191.205/admin
```

→ Pi-hole 관리자 페이지 확인

---

## 2. 초기 접근 (Initial Access)

### Raspberry Pi 기본 크레덴셜

Raspberry Pi OS의 기본값:

|항목|값|
|---|---|
|Username|`pi`|
|Password|`raspberry`|

> Mirai 봇넷이 유명해진 이유 = IoT 기기 **기본 크레덴셜 미변경** 악용

```bash
ssh pi@10.129.191.205
# PW: raspberry
```

→ **바로 접속!**

---

## 3. User Flag

```bash
cat /home/pi/Desktop/user.txt
```

---

## 4. 권한 상승 (Privilege Escalation)

### sudo 권한 확인

```bash
sudo -l
```

**결과:**

```
(ALL : ALL) NOPASSWD: ALL
```

→ **패스워드 없이 모든 명령어 root로 실행 가능!**

```bash
sudo bash
# 또는
sudo su
```

→ **root 획득!**

---

## 5. Root Flag - 삭제된 파일 복구

### USB 마운트포인트 확인

```bash
df -h
lsblk
```

**결과:**

```
/dev/sdb → /media/usbstick
```

### USB 내용 확인

```bash
ls /media/usbstick/
cat /media/usbstick/damnit.txt
```

```
Damnit! Sorry man I accidentally deleted your files off the USB stick.
Do you know if there is any way to get them back?
-James
```

→ flag가 **삭제됨!** 하지만 복구 가능!

### 삭제된 파일 복구 원리

파일 삭제 시:

- 파일시스템 **인덱스(포인터)만 제거**
- 실제 데이터는 **디스크에 그대로 남아있음**
- 새 데이터가 덮어쓰기 전까지 **복구 가능!**

### raw 디바이스에서 flag 복구

```bash
sudo strings /dev/sdb
```

→ 출력에서 **32자리 hex flag** 확인! 🎯

---

## 6. 정리 및 교훈

### 취약점 체인

```
Pi-hole 발견 (X-Pi-hole 헤더)
→ Raspberry Pi 기본 크레덴셜 (pi:raspberry)
→ SSH 접속
→ sudo NOPASSWD ALL → root
→ USB raw 데이터에서 삭제된 flag 복구
```

### 핵심 교훈

- **기본 크레덴셜 변경 필수** (IoT 기기 포함)
- **sudo NOPASSWD ALL** 설정은 매우 위험
- **파일 삭제 ≠ 데이터 삭제** → 완전 삭제는 `shred`, `wipe` 등 사용
- **Mirai 봇넷의 교훈** → 기본 크레덴셜 미변경 IoT 기기가 얼마나 위험한지

### 디지털 포렌식 - 파일 복구 방법

```bash
# strings로 텍스트 추출
sudo strings /dev/sdb

# dcfldd로 이미지 덤프
sudo dcfldd if=/dev/sdb | strings

# foremost로 파일 복구
sudo foremost -i /dev/sdb -o /tmp/recovered
```

### Raspberry Pi 기본 크레덴셜

> 2022년 이후 Raspberry Pi OS는 보안상 이유로 기본 `pi` 계정 제거. 첫 부팅 시 직접 계정 생성하도록 변경됨.

---

## 참고

| 항목                  | 링크                                                                     |
| ------------------- | ---------------------------------------------------------------------- |
| Raspberry Pi 보안 가이드 | https://www.raspberrypi.com/documentation/computers/configuration.html |
| Mirai 봇넷            | https://en.wikipedia.org/wiki/Mirai_(malware)                          |
| Pi-hole             | https://pi-hole.net                                                    |
| strings 명령어         | `man strings`                                                          |