# Abitare Co. Lavorazioni

Portale interno per richieste lavorazioni marketing/creative.

## Stack

- Front-end statico su GitHub Pages
- Backend Supabase Auth + Database + RLS
- Dominio previsto: `lavorazioni.abitareco.it`

## Deploy rapido GitHub

1. Apri repository `abitarecotool/abitareco-lavorazioni`.
2. Carica tutti i file contenuti in questo ZIP nella root del repository.
3. Commit su branch `main`.
4. Vai in `Settings > Pages`.
5. Source: `Deploy from a branch`.
6. Branch: `main`, folder `/root`.
7. Custom domain: `lavorazioni.abitareco.it`.

## Supabase già configurato

Project URL:

```text
https://ddakythxpllinofstzuh.supabase.co
```

Utenti iniziali:

- billy.dolor@abitareco.it → admin
- mattia.nichettistanghellini@abitareco.it → admin
- daniela.buglione@abitareco.it → user

## Aggiungere utenti

1. Supabase > Authentication > Users > Add user.
2. Copia UID creato.
3. Supabase > Table Editor > profiles > Insert row.
4. Inserisci:
   - id = UID
   - email
   - full_name
   - role = `user` oppure `admin`
   - active = `true`

## Disattivare utenti

Non cancellare utenti con ordini storici. Imposta `active = false` nella tabella `profiles`.

## Note

La prima versione salva ordini e stati su Supabase. Le email automatiche sono predisposte come step successivo tramite Supabase Edge Functions + provider email esterno.
