-- Bulk import of the hoarded recipe list, with ingredients mapped onto the
-- existing vocabulary rather than added as fresh free text. Quantities from
-- the source ("tofu 2x", "lęšiai 150g", "pusė morkos") are dropped: the
-- shopping list deliberately has no notion of amounts.

-- The beetroot soup already exists without ingredients. Renaming it first
-- means the import attaches to it instead of creating a second copy.
update public.recipes set title = 'Burokėlių sriuba'
where lower(trim(title)) = 'buroku sriuba';

insert into public.ingredients (household_id, name, section, food_type)
select h.id, v.name, v.section, v.food_type from public.households h
cross join (values
  ('Tikka masala prieskoniai','Spices','Herbs & spices'),
  ('Kajeno pipirai','Spices','Herbs & spices'),
  ('Garstyčių sėklos','Spices','Herbs & spices'),
  ('Daržovės','Produce','Vegetables'),
  ('Artišokai','Pantry','Vegetables'),
  ('Riešutų sviestas','Pantry','Oils & condiments'),
  ('Tahini','Pantry','Oils & condiments'),
  ('Miso pasta','Pantry','Oils & condiments'),
  ('Pesto','Pantry','Oils & condiments'),
  ('Pomidorų padažas','Pantry','Oils & condiments'),
  ('Grybų sultinys','Pantry','Oils & condiments'),
  ('Žirniai','Pantry','Legumes'),
  ('Pupelės','Pantry','Legumes'),
  ('Falafeliai','Pantry','Legumes'),
  ('Sojų kotletų mišinys','Pantry','Legumes'),
  ('Sojos kubeliai','Pantry','Legumes'),
  ('Edamame','Frozen','Legumes'),
  ('Gnocchi','Pantry','Pasta'),
  ('Apvalūs ryžiai','Pantry','Grains'),
  ('Kukurūzų kruopos','Pantry','Grains'),
  ('Lavašas','Bakery','Grains'),
  ('Riešutai','Pantry','Nuts & seeds'),
  ('Nori lapai','Pantry','Other'),
  ('Mielės','Pantry','Other'),
  ('Baltas vynas','Pantry','Other'),
  ('Raudonas vynas','Pantry','Other'),
  ('Tamsus alus','Pantry','Other'),
  ('Uogienė','Pantry','Sweeteners'),
  ('Bruknių uogienė','Pantry','Sweeteners')
) as v(name, section, food_type)
on conflict do nothing;

create table private._import (title text primary key, tag text not null, ingredients text[] not null, source_url text);
insert into private._import values
('Lęšių karis su bulvėm ir ryžiais','Troškiniai',array['Lęšiai','Bulvės','Pomidorai','Morkos','Paprikos','Kokosų kremas','Ryžiai'],null),
('Karis su tofu ir lęšiais','Troškiniai',array['Tofu','Lęšiai','Špinatai','Kokosų kremas','Pomidorai','Paprikos','Čili pipirai','Daržovių sultinys','Tikka masala prieskoniai'],null),
('Tailandietiškas lęšių karis su grybais','Troškiniai',array['Lęšiai','Grybai','Kario prieskoniai','Pomidorai','Kokosų kremas','Ryžiai'],null),
('Cukinijų troškinys su ryžiais','Troškiniai',array['Cukinijos','Pomidorai','Tofu','Ryžiai'],null),
('Avinžirnių troškinys su kuskusu','Troškiniai',array['Avinžirniai','Pomidorai','Daržovės','Kuskusas'],null),
('Kopūstų troškinys su bulvėm','Troškiniai',array['Kopūstai','Pomidorai','Bulvės','Daržovių sultinys'],null),
('Karis su saldžiom bulvėm ir špinatais','Troškiniai',array['Saldžiosios bulvės','Špinatai','Kokosų kremas','Imbieras','Riešutų sviestas','Citrinos','Kario prieskoniai'],null),
('Raudonų lęšių troškinys su aštriu aliejum','Troškiniai',array['Raudonieji lęšiai','Svogūnai','Morkos','Čili pipirai','Garstyčių sėklos','Kuminas','Česnakai'],null),
('Bolivinių balandų troškinys su daržovėmis','Troškiniai',array['Kvinoja','Cukinijos','Paprikos','Morkos','Avinžirniai','Pomidorai'],null),
('Marokietiškas taginas su avinžirniais','Troškiniai',array['Avinžirniai','Moliūgai','Džiovinti abrikosai','Razinos','Cinamonas','Kuminas','Kuskusas'],null),
('Moliūgų sriuba','Sriubos',array['Moliūgai','Grietinėlė','Svogūnai','Morkos','Daržovių sultinys'],null),
('Burokėlių sriuba','Sriubos',array['Burokėliai','Svogūnai','Morkos','Daržovių sultinys','Bulvės'],null),
('Trinta žirnių sriuba','Sriubos',array['Žirniai','Svogūnai','Morkos','Daržovių sultinys'],null),
('Kopūstų sriuba','Sriubos',array['Duona','Bulvės','Svogūnai','Morkos','Kopūstai'],null),
('Čili sriuba','Sriubos',array['Sojų faršas','Pomidorai','Pupelės','Daržovių sultinys','Svogūnai','Morkos','Čili pipirai'],null),
('Pomidorų sriuba','Sriubos',array['Pomidorai','Svogūnai','Morkos','Daržovių sultinys','Duona'],null),
('Raudonųjų lęšių sriuba','Sriubos',array['Raudonieji lęšiai','Konservuoti pomidorai','Morkos','Svogūnai','Daržovių sultinys'],null),
('Ramenai','Sriubos',array['Makaronai','Tofu','Svogūnai','Morkos','Kokosų kremas','Sojų padažas','Imbieras','Grybai','Kukurūzai','Sojos pupelės','Nori lapai','Miso pasta'],null),
('Šaltibarščiai','Sriubos',array['Burokėliai','Jogurtas','Agurkai','Krapai','Žali svogūnai','Bulvės'],null),
('Makaronai su burokėlių salotom','Makaronai',array['Makaronai','Tofu','Pomidorai','Paprikos','Burokėliai'],null),
('Spagečiai su česnaku ir aliejum','Makaronai',array['Spagečiai','Česnakai','Alyvuogių aliejus'],null),
('Lazanija','Makaronai',array['Lazanijos lakštai','Pomidorai','Sūris','Paprikos','Tofu','Grietinėlė'],null),
('Makaronai su grybų padažu','Makaronai',array['Grybai','Kokosų kremas','Česnakai','Makaronai'],null),
('Makaronai su pesto','Makaronai',array['Makaronai','Pesto'],null),
('Riešutiniai makaronai','Makaronai',array['Spagečiai','Riešutų sviestas','Citrinos','Sojų padažas','Česnakai','Mielių dribsniai','Daržovės'],null),
('Kreminiai makaronai','Makaronai',array['Spagečiai','Pomidorai','Anakardžiai','Tofu'],null),
('Kugelis','Bulviniai',array['Bulvės','Svogūnai','Miltai'],null),
('Bulviniai blynai','Bulviniai',array['Bulvės','Miltai','Svogūnai'],null),
('Orkaitėje keptos bulvės su salotom','Bulviniai',array['Bulvės','Salotos','Alyvuogių aliejus'],null),
('Keptos saldžios bulvės su tahini padažu','Bulviniai',array['Saldžiosios bulvės','Avinžirniai','Tahini','Citrinos','Sojų padažas'],null),
('Piemenėlio pyragas','Bulviniai',array['Bulvės','Lęšiai','Šaldyti žirneliai','Grybai','Pomidorų pasta','Daržovių sultinys'],null),
('Gnocchi su špinatais ir kokosų kremu','Bulviniai',array['Gnocchi','Špinatai','Kokosų kremas','Česnakai','Mielių dribsniai'],null),
('Falafelių kebabai','Ankštiniai',array['Lavašas','Falafeliai','Pomidorai','Kiniški kopūstai','Jogurtas','Tahini','Česnakai','Marinuoti agurkai'],null),
('Keptos pupelės','Ankštiniai',array['Pupelės','Pomidorų padažas'],null),
('Falafeliai su bulvėm ir burokėlių salotom','Ankštiniai',array['Avinžirniai','Bulvės','Burokėliai'],null),
('Humusas su daržovėmis ir pita','Ankštiniai',array['Avinžirniai','Tahini','Citrinos','Morkos','Agurkai','Pita duona'],null),
('Gyros su falafeliais ir tzatziki','Ankštiniai',array['Miltai','Avinžirniai','Jogurtas','Agurkai','Česnakai','Krapai','Citrinos','Marinuoti agurkai','Raudonieji svogūnai'],null),
('Tuna sumuštiniai','Ankštiniai',array['Avinžirniai','Raudonieji svogūnai','Salierai','Kaparėliai','Nori lapai','Mielių dribsniai','Citrinos','Krapai','Kokosų kremas','Duona'],null),
('Moliūgų ir špinatų risotto','Ryžiai',array['Moliūgai','Špinatai','Mielių dribsniai','Grietinėlė','Apvalūs ryžiai','Baltas vynas'],null),
('Bowl''ai','Ryžiai',array['Ryžiai','Tofu','Sojos pupelės','Morkos','Raudonieji svogūnai','Riešutų sviestas','Citrinos','Sojų padažas','Česnakai'],null),
('Daržovių paella','Ryžiai',array['Apvalūs ryžiai','Artišokai','Paprikos','Alyvuogės','Šaldyti žirneliai','Petražolės','Citrinos','Rūkyta paprika','Daržovių sultinys','Pomidorai','Avinžirniai','Baltas vynas'],'https://cookieandkate.com/vegetable-paella-recipe/'),
('Grikiai su tofu ir kukurūzais','Grikiai',array['Grikiai','Tofu','Kukurūzai','Burokėliai'],null),
('Polenta su grybais','Kukurūzai',array['Kukurūzų kruopos','Grybai','Kokosų kremas','Baltas vynas','Česnakai','Mielių dribsniai'],null),
('Grybų Bourguignon su bulvių koše','Grybai',array['Bulvės','Grybai','Miso pasta','Sojų padažas','Lauro lapai','Čiobreliai','Grybų sultinys','Pomidorų pasta','Miltai','Raudonas vynas'],null),
('Panzanella','Salotos',array['Duona','Pomidorai','Agurkai','Raudonieji svogūnai','Bazilikas','Alyvuogių aliejus','Actas'],null),
('Traškios avinžirnių salotos','Salotos',array['Avinžirniai','Agurkai','Pomidorai','Morkos','Raudonieji svogūnai','Citrinos'],null),
('Rūgšti lęšių tabbouleh','Salotos',array['Žali lęšiai','Citrinos','Mėtos','Petražolės','Agurkai','Pomidorai','Raudonieji svogūnai'],null),
('Makaronų salotos su edamame','Salotos',array['Edamame','Makaronai','Citrinos','Agurkai','Pomidorai','Raudonieji svogūnai'],null),
('Švediški sojų kotletai su bulvių koše','Soja',array['Sojų kotletų mišinys','Bulvės','Bruknių uogienė','Grietinėlė','Grybai'],null),
('Soja tikka masala su basmati','Soja',array['Basmati ryžiai','Sojos kubeliai','Pomidorai','Tikka masala prieskoniai','Jogurtas'],null),
('Moliūgų burgeriai','Junk',array['Moliūgai','Bandelės','Raudonieji svogūnai','Kiniški kopūstai','Tamsus alus'],null),
('Pica','Junk',array['Miltai','Mielės','Pomidorai','Sūris'],null),
('Tofu scramble','Pusrytiniai',array['Tofu','Pievagrybiai','Ciberžolė'],null),
('Shakshuka','Pusrytiniai',array['Avinžirniai','Pomidorai','Tofu','Paprikos','Alyvuogės','Kuminas','Kajeno pipirai'],null),
('Avižiniai dribsniai su bananais ir riešutais','Pusrytiniai',array['Avižiniai dribsniai','Augalinis pienas','Bananai','Riešutai'],null),
('Veganiški blyneliai su uogiene','Pusrytiniai',array['Miltai','Augalinis pienas','Uogienė'],null),
('Avižinė košė su riešutų sviestu','Pusrytiniai',array['Avižiniai dribsniai','Augalinis pienas','Riešutų sviestas','Bananai'],null),
('Ryžių pudingas','Pusrytiniai',array['Apvalūs ryžiai','Augalinis pienas','Cukrus'],null);

insert into public.tags (household_id, name)
select distinct h.id, d.tag from public.households h cross join private._import d
on conflict do nothing;

insert into public.recipes (household_id, title, source_url, created_by)
select h.id, d.title, d.source_url,
  (select m.user_id from public.household_members m where m.household_id = h.id order by m.created_at limit 1)
from public.households h cross join private._import d
where not exists (
  select 1 from public.recipes r where r.household_id = h.id and lower(trim(r.title)) = lower(trim(d.title))
);

insert into public.recipe_ingredients (household_id, recipe_id, ingredient_id, position)
select r.household_id, r.id, i.id, (u.ord - 1)::int
from private._import d
join public.recipes r on lower(trim(r.title)) = lower(trim(d.title))
cross join lateral unnest(d.ingredients) with ordinality as u(name, ord)
join public.ingredients i on i.household_id = r.household_id and lower(trim(i.name)) = lower(trim(u.name))
on conflict do nothing;

insert into public.recipe_tags (household_id, recipe_id, tag_id)
select r.household_id, r.id, t.id
from private._import d
join public.recipes r on lower(trim(r.title)) = lower(trim(d.title))
join public.tags t on t.household_id = r.household_id and t.name = d.tag
on conflict do nothing;

drop table private._import;
