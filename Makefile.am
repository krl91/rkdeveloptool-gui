## Copyright (C) 2017  Trevor Woerner <twoerner@gmail.com>

SUBDIRS =
DIST_SUBDIRS = cfg

AM_CPPFLAGS = -Wall -Werror -Wextra -Wreturn-type -fno-strict-aliasing -D_FILE_OFFSET_BITS=64 -D_LARGE_FILE $(LIBUSB1_CFLAGS)

bin_PROGRAMS = rkdeveloptool
rkdeveloptool_SOURCES = main.cpp \
	crc.cpp DefineHeader.h Endian.h DefineHeader.h Property.hpp \
	RKBoot.cpp RKBoot.h \
	RKComm.cpp RKComm.h \
	RKDevice.cpp RKDevice.h \
	RKImage.cpp RKImage.h \
	RKLog.cpp RKLog.h \
	RKScan.cpp RKScan.h \
	gpt.h
rkdeveloptool_LDADD = $(LIBUSB1_LIBS)

GUI_BINARY = gui/bin/rkdeveloptool$(EXEEXT)

if BUILD_GUI
all-local: gui-dist
endif

.PHONY: gui gui-package gui-dist gui-dist-dir gui-test gui-clean

gui: gui-dist

gui-package: gui-dist

$(GUI_BINARY): rkdeveloptool$(EXEEXT)
	$(MKDIR_P) gui/bin
	cp -f ./rkdeveloptool$(EXEEXT) $(GUI_BINARY)

gui-dist: $(GUI_BINARY)
	cd gui && $(NPM) install
	cd gui && $(NPM) run dist

gui-dist-dir: $(GUI_BINARY)
	cd gui && $(NPM) install
	cd gui && $(NPM) run dist:dir

gui-test:
	cd gui && $(NPM) install
	cd gui && $(NPM) run check
	cd gui && $(NPM) test
	cd gui && $(NPM) run coverage

gui-clean:
	if test -d gui/dist; then find gui/dist -name .DS_Store -delete; chmod -R u+w gui/dist; fi
	if test -d gui/log; then find gui/log -name .DS_Store -delete; chmod -R u+w gui/log; fi
	-rm -fr gui/dist gui/log gui/bin/rkdeveloptool gui/bin/rkdeveloptool.exe

clean-local:: gui-clean
	rm -fr log
