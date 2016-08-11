@if .%1 == . goto start
@echo **********************************
@echo Starting APALO Express Application
SET PORT=3000
SET PALO_SERVER=192.0.0.175
@SET PALO_PASSWD=0x6485A16D1C44D58FBEE2585DF2CCA66A
@rem default: 0x21232F297A57A5A743894A0E4A801FC3
@cd APALO-EXPRESS
node bin\www
@cd ..
@goto end
:start
@call %0 START <nul
:end
