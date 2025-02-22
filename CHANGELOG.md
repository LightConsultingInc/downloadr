# Changelog

## [1.1.3](https://github.com/LightConsultingInc/downloadr/compare/v1.1.2...v1.1.3) (2025-02-22)


### Bug Fixes

* use content range because HEAD was return 403 ([d344daa](https://github.com/LightConsultingInc/downloadr/commit/d344daada2027d1897e4a3f196b1508a3764cab5))

## [1.1.2](https://github.com/LightConsultingInc/downloadr/compare/v1.1.1...v1.1.2) (2025-02-20)


### Bug Fixes

* handle 200 response codes for servers without byte range support ([d4976da](https://github.com/LightConsultingInc/downloadr/commit/d4976dadca941d76701160e73426bba6b757d77a)), closes [#15](https://github.com/LightConsultingInc/downloadr/issues/15)
* remove byte range modification in downloadChunk ([1395a71](https://github.com/LightConsultingInc/downloadr/commit/1395a71e22e4a1da339c8874f3e61dd1d24d9d09))

## [1.1.1](https://github.com/LightConsultingInc/downloadr/compare/v1.1.0...v1.1.1) (2025-02-12)


### Bug Fixes

* handle missing content-length header by downloading in single chunk ([db9129d](https://github.com/LightConsultingInc/downloadr/commit/db9129d64eaa3ffe32b2aac867d2b28edbea839d))

## [1.1.0](https://github.com/LightConsultingInc/downloadr/compare/v1.0.0...v1.1.0) (2025-02-11)


### Features

* support downloads over http or https ([7f2c76e](https://github.com/LightConsultingInc/downloadr/commit/7f2c76e60f31772038a0ccf34231ddadcbe721f3))

## 1.0.0 (2025-02-11)


### Features

* expose method to get total file size ([457777c](https://github.com/LightConsultingInc/downloadr/commit/457777cd25354f288d8da7d285324aef17a72cd9))
* initial functionality of the download manager ([97662be](https://github.com/LightConsultingInc/downloadr/commit/97662bef3352f82b60dea7804dd08a0b9afc224e))
