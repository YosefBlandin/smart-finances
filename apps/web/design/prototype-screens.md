# Account screens in the prototype (SF-101, D-100)

Every sign-up, sign-in and account screen and state, in English and Spanish. Message keys are `screen.part`; the same keys will go into `apps/web/messages/en.json` and `es.json`. `{name}` marks a value filled in at run time. Tags such as `<privacy>` are rich text (next-intl `t.rich`). Synthetic values only (example.com addresses).

Open the prototype, then Prototype > Account screens. Pick a screen, then a state.

## Screens and states

| Screen | Key | States | Notes |
|---|---|---|---|
| Sign up | `signUp` | default, working, weak, limit, botcheck | AC-12, AC-14, AC-19. Terms and privacy accepted before submit; proof-of-work note. |
| Confirm email | `confirm` | default, resent, wrong, expired | AC-12. Account exists only after the code. Code lifetime (15 min) is a prototype value to confirm against the pool settings. |
| Authenticator setup | `setup` | default, wrong | AC-13. Blocks every money screen until done. |
| Sign in | `signIn` | default, wrong | AC-1, AC-16. Footer copy: sign out when done; session ends after 30 idle minutes. |
| Authenticator code | `code` | default, wrong | AC-1. Link to the lost-authenticator screen. |
| Forgot password | `reset` | default, sent | AC-20. Same message whether or not an account exists. |
| New password | `resetConfirm` | default, wrong, weak | AC-20. Still asks for the authenticator code at sign-in. |
| Lost authenticator | `lost` | default | No self-service reset; contact the owner. Reply time (a day or two) is a prototype value to confirm. |
| Privacy and terms | `consent` | default, working | AC-14. Records acceptance with date and version. |
| Delete account | `deleteAccount` | reauth, warning, working, partial, done | AC-18. Re-sign-in, warning with typed DELETE, partial failure, signed-out result with counts. No temporary-password screen exists anywhere. |
| Too many tries | `tooMany` | signIn, signUp, code | AC-17, AC-19. Plain message with wait time. |
| Not found | `notFound` | default | AC-8. |
| Signed out (idle) | `idle` | default | SF-112. Sign-in with the reason=idle banner. |

## Message keys

English text shown; the Spanish text is in the prototype under the same key.

| Key | English | Spanish |
|---|---|---|
| `intro` | Every sign-up, sign-in and account screen the app needs, in both languages. Pick a screen, then one of its states. These screens show without the side rail. | Todas las pantallas de registro, inicio de sesión y cuenta que necesita la app, en los dos idiomas. Elige una pantalla y luego uno de sus estados. Estas pantallas se muestran sin el menú lateral. |
| `common.email` | Email | Correo |
| `common.password` | Password | Contraseña |
| `common.contact` | help@example.com | help@example.com |
| `common.sample` | you@example.com | you@example.com |
| `common.digit` | Digit | Dígito |
| `common.codeDigits` | Six-digit code | Código de seis dígitos |
| `common.footer` | Sign out when you’re done; the session also ends after 30 idle minutes. | Cierra la sesión al terminar; también se cierra sola tras 30 minutos sin actividad. |
| `common.cancel` | Cancel | Cancelar |
| `common.back` | Back to sign in | Volver a entrar |
| `signUp.title` | Create your account | Crea tu cuenta |
| `signUp.lead` | Bring your own files and see where your money goes. It takes about three minutes. | Trae tus archivos y mira en qué se va tu plata. Son unos tres minutos. |
| `signUp.passwordHint` | At least 12 characters. A short phrase works well. | Al menos 12 caracteres. Una frase corta sirve. |
| `signUp.privacyTitle` | What you’re agreeing to | A qué estás aceptando |
| `signUp.privacyBody` | Cuenta keeps the files you import and the rows inside them. Nobody else’s account can read yours. You can export or erase everything at any time. | Cuenta guarda los archivos que importas y las filas que traen. Ninguna otra cuenta puede leer la tuya. Puedes exportar o borrar todo cuando quieras. |
| `signUp.accept` | I have read the <privacy>privacy notice</privacy> and accept the <terms>terms</terms>. | Leí el <privacy>aviso de privacidad</privacy> y acepto los <terms>términos</terms>. |
| `signUp.proof` | When you press the button, your browser runs a short check, a few seconds long, to keep automated sign-ups out. There is nothing to solve. | Al apretar el botón, tu navegador hace una verificación corta, de unos segundos, para dejar fuera los registros automáticos. No tienes que resolver nada. |
| `signUp.submit` | Create account | Crear cuenta |
| `signUp.creating` | Checking… | Verificando… |
| `signUp.haveAccount` | Already have an account? | ¿Ya tienes cuenta? |
| `signUp.signInLink` | Sign in | Entrar |
| `signUp.errWeak` | That password is too short or too common. Use at least 12 characters and avoid common words. | Esa contraseña es muy corta o muy común. Usa al menos 12 caracteres y evita palabras comunes. |
| `signUp.errLimit` | Too many sign-ups from this connection. Try again in an hour. | Hubo demasiados registros desde esta conexión. Vuelve a intentar en una hora. |
| `signUp.errBot` | The check didn’t pass, so we haven’t created an account. Reload the page and try again, or write to {contact}. | La verificación no pasó, así que no creamos la cuenta. Recarga la página y vuelve a intentar, o escribe a {contact}. |
| `confirm.title` | Check your email | Revisa tu correo |
| `confirm.lead` | We sent a 6-digit code to {email}. The account is created once you enter it. The code works for 15 minutes. | Enviamos un código de 6 dígitos a {email}. La cuenta se crea cuando lo ingresas. El código sirve por 15 minutos. |
| `confirm.submit` | Confirm email | Confirmar correo |
| `confirm.confirming` | Confirming… | Confirmando… |
| `confirm.resend` | Send a new code | Enviar un código nuevo |
| `confirm.spam` | Nothing yet? Look in your spam folder first. | ¿No llega? Mira primero en la carpeta de spam. |
| `confirm.wrongAddress` | Wrong address? Start again | ¿Correo equivocado? Empezar de nuevo |
| `confirm.resent` | We sent a new code. The old one no longer works. | Enviamos un código nuevo. El anterior ya no sirve. |
| `confirm.resentWait` | You can ask for another one in 30 seconds. | Puedes pedir otro en 30 segundos. |
| `confirm.errWrong` | That code doesn’t match. Check the digits and try again. | Ese código no coincide. Revisa los dígitos y vuelve a intentar. |
| `confirm.errExpired` | This code has expired. Ask for a new one. | Este código venció. Pide uno nuevo. |
| `setup.title` | Set up your authenticator | Configura tu autenticador |
| `setup.lead` | Cuenta asks for a code from an authenticator app each time you sign in. It keeps your money private even if someone learns your password. | Cuenta te pide un código de una app autenticadora cada vez que entras. Así tu plata sigue privada aunque alguien sepa tu contraseña. |
| `setup.required` | You can’t see any money screen until this is done. | No puedes ver ninguna pantalla con dinero hasta terminar esto. |
| `setup.step1` | Open an authenticator app on your phone and scan this square. | Abre una app autenticadora en tu teléfono y escanea este cuadrado. |
| `setup.step2` | Type the 6-digit code the app shows. | Escribe el código de 6 dígitos que muestra la app. |
| `setup.cantScan` | Can’t scan? Type this key instead: | ¿No puedes escanear? Escribe esta clave: |
| `setup.keyNote` | (example) | (ejemplo) |
| `setup.qrLabel` | QR code, example | Código QR, ejemplo |
| `setup.submit` | Turn on authenticator | Activar autenticador |
| `setup.errWrong` | That code didn’t work. Codes change every 30 seconds, so type the newest one. | Ese código no funcionó. Los códigos cambian cada 30 segundos; escribe el más reciente. |
| `signIn.title` | Sign in | Entrar |
| `signIn.lead` | Type your email and password. Your authenticator code comes next. | Escribe tu correo y tu contraseña. Después te pedimos el código de tu autenticador. |
| `signIn.submit` | Continue | Continuar |
| `signIn.forgot` | Forgot your password? | ¿Olvidaste tu contraseña? |
| `signIn.newHere` | New here? | ¿Primera vez? |
| `signIn.create` | Create an account | Crear una cuenta |
| `signIn.errWrong` | That email and password don’t match. Check both and try again. | El correo y la contraseña no coinciden. Revisa ambos y vuelve a intentar. |
| `code.title` | Enter your code | Ingresa tu código |
| `code.lead` | Open your authenticator app and type the 6-digit code for Cuenta. | Abre tu app autenticadora y escribe el código de 6 dígitos de Cuenta. |
| `code.submit` | Sign in | Entrar |
| `code.errWrong` | That code didn’t work. Type the newest one from your app. | Ese código no funcionó. Escribe el más reciente de tu app. |
| `code.lost` | Lost your authenticator? | ¿Perdiste tu autenticador? |
| `reset.title` | Reset your password | Restablece tu contraseña |
| `reset.lead` | Type your email. If there’s an account, we’ll send you a code. | Escribe tu correo. Si hay una cuenta, te enviamos un código. |
| `reset.submit` | Send code | Enviar código |
| `reset.sentTitle` | Check your email | Revisa tu correo |
| `reset.sentLead` | If {email} has an account, a code is on its way. It can take a minute. | Si {email} tiene una cuenta, el código va en camino. Puede tardar un minuto. |
| `reset.next` | Enter the code | Ingresar el código |
| `resetConfirm.title` | Choose a new password | Elige una contraseña nueva |
| `resetConfirm.lead` | Type the code from your email and your new password. You’ll still need your authenticator code to sign in. | Escribe el código de tu correo y tu contraseña nueva. Para entrar seguirás necesitando el código de tu autenticador. |
| `resetConfirm.code` | Code from your email | Código de tu correo |
| `resetConfirm.newPassword` | New password | Contraseña nueva |
| `resetConfirm.submit` | Save new password | Guardar contraseña nueva |
| `resetConfirm.resend` | Send a new code | Enviar un código nuevo |
| `resetConfirm.errWrong` | That code doesn’t match or has expired. Check your email, or ask for a new one. | Ese código no coincide o venció. Revisa tu correo o pide uno nuevo. |
| `lost.title` | Lost your authenticator? | ¿Perdiste tu autenticador? |
| `lost.lead` | You can’t reset it on your own. That protects your money if someone else gets your password. | No puedes restablecerlo por tu cuenta. Así tu plata queda protegida si otra persona consigue tu contraseña. |
| `lost.step1` | Write to {contact} from the email you signed up with. | Escribe a {contact} desde el correo con el que te registraste. |
| `lost.step2` | Say that you lost your authenticator. Never send your password or a code. | Cuéntanos que perdiste tu autenticador. Nunca envíes tu contraseña ni un código. |
| `lost.step3` | We check it’s you and reset it. You set up a new one the next time you sign in. | Verificamos que eres tú y lo restablecemos. Configuras uno nuevo la próxima vez que entres. |
| `lost.wait` | A person answers, so it can take a day or two. | Te responde una persona, así que puede tardar uno o dos días. |
| `consent.title` | Your data, in plain words | Tus datos, en palabras simples |
| `consent.lead` | Read this once, then accept to continue. You can find it again any time under Your data. | Léelo una vez y acepta para seguir. Lo encuentras de nuevo cuando quieras en Tus datos. |
| `consent.keepTitle` | What we keep | Qué guardamos |
| `consent.keep1` | The files you import, and every row inside them with its original text. | Los archivos que importas y cada fila que traen, con su texto original. |
| `consent.keep2` | Your review choices and your dollar rates. | Tus revisiones y tus cotizaciones del dólar. |
| `consent.keep3` | Your email, and the date you accepted this page. | Tu correo y la fecha en que aceptaste esta página. |
| `consent.whereTitle` | Where it lives | Dónde vive |
| `consent.where` | In one cloud account, filed under your sign-in. No other account can read it. | En una sola cuenta en la nube, a nombre de tu inicio de sesión. Ninguna otra cuenta puede leerlo. |
| `consent.howLongTitle` | How long we keep it | Cuánto tiempo lo guardamos |
| `consent.howLong` | Until you erase it. After that, backups keep it for 35 days, then it’s gone for good. | Hasta que lo borres. Después, las copias de seguridad lo guardan 35 días y luego desaparece del todo. |
| `consent.removeTitle` | How to remove it | Cómo quitarlo |
| `consent.remove` | Export or erase everything, or delete your account, at any time from Your data. | Exporta o borra todo, o borra tu cuenta, cuando quieras desde Tus datos. |
| `consent.accept` | I have read the <privacy>privacy notice</privacy> and accept the <terms>terms</terms>. | Leí el <privacy>aviso de privacidad</privacy> y acepto los <terms>términos</terms>. |
| `consent.record` | We record that you accepted, with the date and the version of this page. | Guardamos que aceptaste, con la fecha y la versión de esta página. |
| `consent.submit` | Accept and continue | Aceptar y continuar |
| `consent.saving` | Saving… | Guardando… |
| `consent.decline` | No thanks, sign out | No, gracias; cerrar sesión |
| `delete.reauthTitle` | Confirm it’s you | Confirma que eres tú |
| `delete.reauthLead` | To delete your account, sign in again. That stops anyone using a computer you left open. | Para borrar tu cuenta, vuelve a entrar. Así nadie puede hacerlo desde una computadora que dejaste abierta. |
| `delete.continue` | Continue | Continuar |
| `delete.warnTitle` | Delete your account | Borra tu cuenta |
| `delete.warnLead` | This erases everything and closes your account. It can’t be undone from here. | Esto borra todo y cierra tu cuenta. No se puede deshacer desde aquí. |
| `delete.warn1` | Every transaction, file, review choice and dollar rate. | Todos los movimientos, archivos, revisiones y cotizaciones. |
| `delete.warn2` | Your sign-in. To come back, you’d sign up again. | Tu inicio de sesión. Para volver, tendrías que crear otra cuenta. |
| `delete.warn3` | Every session, on every device. | Todas las sesiones, en todos tus dispositivos. |
| `delete.backups` | Backups keep your data for 35 days, then it’s gone for good. Export first if you want a copy. | Las copias de seguridad guardan tus datos 35 días y luego desaparecen del todo. Exporta antes si quieres una copia. |
| `delete.typeDelete` | Type DELETE to confirm | Escribe DELETE para confirmar |
| `delete.submit` | Delete my account | Borrar mi cuenta |
| `delete.exportFirst` | Export first | Exportar antes |
| `delete.workingTitle` | Deleting your account | Borrando tu cuenta |
| `delete.working` | Erasing {tx} transactions and {files} files, then ending your sessions… | Borrando {tx} movimientos y {files} archivos, y cerrando tus sesiones… |
| `delete.stay` | Stay on this page until it finishes. | Quédate en esta página hasta que termine. |
| `delete.partialTitle` | Your account is closed, but not everything is erased | Tu cuenta está cerrada, pero no se borró todo |
| `delete.partialLead` | Every session has ended and you can’t sign in. We couldn’t erase {left} items yet. We keep trying; you don’t need to do anything. | Se cerraron todas las sesiones y ya no puedes entrar. Todavía no pudimos borrar {left} elementos. Seguimos intentando; no tienes que hacer nada. |
| `delete.partialHelp` | Questions? Write to {contact} and quote the reference below. | ¿Dudas? Escribe a {contact} y cita la referencia de abajo. |
| `delete.reference` | Reference | Referencia |
| `delete.referenceValue` | erase-4d2b…91 | erase-4d2b…91 |
| `delete.partlyErased` | Partly erased | Borrado parcial |
| `delete.doneTitle` | Your account is deleted | Tu cuenta está borrada |
| `delete.doneLead` | You’re signed out on every device. Here’s what we removed. | Cerramos tu sesión en todos los dispositivos. Esto es lo que quitamos. |
| `delete.transactions` | Transactions | Movimientos |
| `delete.files` | Files | Archivos |
| `delete.choices` | Review choices | Revisiones |
| `delete.rates` | Dollar rates | Cotizaciones |
| `delete.doneNote` | This page is the only record. We can’t show it again. | Esta página es el único registro. No podemos mostrarla de nuevo. |
| `delete.doneBackups` | Backups keep it for 35 days, then it’s gone for good. | Las copias de seguridad lo guardan 35 días y luego desaparece del todo. |
| `delete.start` | Back to the start | Volver al inicio |
| `tooMany.title` | Too many tries | Demasiados intentos |
| `tooMany.signIn` | For your safety, sign-in is paused for this account. Try again in {minutes} minutes. | Por tu seguridad, el inicio de sesión de esta cuenta está en pausa. Vuelve a intentar en {minutes} minutos. |
| `tooMany.signUp` | Too many sign-ups came from this connection. Try again in an hour. | Hubo demasiados registros desde esta conexión. Vuelve a intentar en una hora. |
| `tooMany.code` | Too many wrong codes. Wait {minutes} minutes, then type the newest code from your app. | Demasiados códigos incorrectos. Espera {minutes} minutos y escribe el código más reciente de tu app. |
| `tooMany.wait` | Waiting is the only fix. Trying again sooner won’t help. | Esperar es la única solución. Intentar antes no ayuda. |
| `notFound.label` | Not found | No encontrada |
| `notFound.title` | We can’t find that page | No encontramos esa página |
| `notFound.lead` | The address may be old or mistyped. Your money is exactly where you left it. | La dirección puede ser vieja o tener un error. Tu plata está justo donde la dejaste. |
| `notFound.go` | Go to the overview | Ir al resumen |
| `notFound.signIn` | Sign in | Entrar |
| `idle.banner` | You were signed out after 30 minutes without activity. Sign in to pick up where you left off. | Cerramos tu sesión tras 30 minutos sin actividad. Entra de nuevo para seguir donde lo dejaste. |

## Picker labels (prototype only)

Keys `pick.*` and `v.*` name the screens and states in the prototype's picker. They are not app messages.
