OTA WAP browser data collector
======================

OTA browser data collector is a simple tool that collect non-sensitive data of user's interaction with browser such as click, typing etc. and DOM node changes for OTA BAM model training purposes. The data will be organized in WAP, which is our standard protocol for AI Agent record-and-play training and inferencing.


Installation
-----

TBD

Usage
-----

Open Chrome DevTools and navigate to the "OTA user interaction data helper" panel. From here you can:

- start listening/recording ("Record" button)

How does it work?
-----
[MutationObserver](https://developer.mozilla.org/en/docs/Web/API/MutationObserver).


Thanks to
------

[DOMListenerExtension](https://github.com/kdzwinel/DOMListenerExtension)

License
-------

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
