-- The route becomes data.
--
-- Until now STOPS, LEGS and their road geometry were constants in lib/plan.ts,
-- which is exactly why notes keyed to a stop index and progress counted legs.
-- Inserting a city shifts every one of those keys, so the route moves into
-- tables with stable ids and everything that pointed at an index now points at
-- a uuid that never moves.
--
-- A leg belongs to the stop it leaves from: each row carries the drive to the
-- NEXT stop by position, and the last stop carries none. That way a leg has no
-- identity of its own to keep in sync — insert a city and only its two
-- neighbours' drives change.
--
-- Positions are fractional on purpose. Inserting between 3 and 4 takes 3.5 and
-- touches no other row, so there is no renumbering pass that could half-apply.
--
-- This file was generated from lib/plan.ts and lib/planGeometry.ts so the seeded
-- route cannot drift from the constants it replaces.

create table route_stops (
  id              uuid primary key default gen_random_uuid(),
  position        double precision not null unique,
  name            text not null,
  lng             double precision not null,
  lat             double precision not null,

  rest_nights     smallint not null default 0 check (rest_nights between 0 and 30),
  note            text not null default '',
  -- About the drive OUT of here, not about the place.
  drive_note      text not null default '',

  -- The drive to the next stop by position. Null on the final stop only.
  drive_miles     integer,
  drive_minutes   integer,
  drive_via       text,
  drive_estimated boolean not null default false,
  drive_geometry  jsonb
);

create index on route_stops (position);

-- Out-and-back excursions from a stop. They add mileage and time but not a day,
-- and they never touch the chain — which is the whole difference between a side
-- trip and inserting a city.
create table route_side_trips (
  id       uuid primary key default gen_random_uuid(),
  stop_id  uuid not null references route_stops(id) on delete cascade,
  name     text not null,
  lng      double precision not null,
  lat      double precision not null,
  miles    integer not null,
  minutes  integer not null,
  geometry jsonb not null
);

create index on route_side_trips (stop_id);


-- Seed the nine stops and eight drives that were hardcoded.
insert into route_stops (position, name, lng, lat, drive_miles, drive_minutes, drive_via, drive_estimated, drive_geometry) values
  (0, 'Boston, MA', -71.0589, 42.3601, 474, 418, 'Buffalo, NY (US-only routing)', false, '[[-71.0585,42.3597],[-71.412,42.3155],[-71.6186,42.2294],[-71.756,42.2211],[-72.0613,42.1297],[-72.2136,42.1825],[-72.3815,42.1539],[-72.5861,42.1698],[-72.694,42.139],[-72.9054,42.1724],[-73.1622,42.2912],[-73.3524,42.3076],[-73.6223,42.4796],[-73.7869,42.5141],[-73.7801,42.6318],[-74.0118,42.7848],[-74.0132,42.8392],[-74.0891,42.8931],[-74.3793,42.9483],[-74.5299,42.8942],[-74.6066,42.9154],[-74.6715,42.9895],[-75.0104,43.018],[-75.2746,43.1372],[-75.6097,43.1259],[-75.7618,43.0902],[-76.1573,43.0919],[-76.2358,43.1181],[-76.9707,42.9549],[-77.4147,42.9986],[-77.5843,43.0482],[-78.3907,43.0104],[-78.6099,42.9504],[-78.7586,42.9517],[-78.8788,42.8865],[-78.9898,43.0896],[-79.0377,43.0962]]'::jsonb),
  (1, 'Niagara Falls, NY', -79.0377, 43.0962, 558, 493, 'Cleveland, OH (US-only routing)', false, '[[-79.0377,43.0962],[-78.991,43.0896],[-78.971,43.0162],[-78.9107,42.9821],[-78.8173,42.7705],[-79.1488,42.5201],[-79.3668,42.4551],[-80.134,42.0266],[-80.3856,41.9466],[-80.5081,41.9428],[-80.8789,41.7746],[-81.0443,41.7602],[-81.4502,41.5921],[-81.4966,41.6055],[-81.6945,41.4993],[-81.6947,41.4747],[-81.7627,41.4674],[-82.0511,41.4649],[-82.1055,41.4061],[-82.3706,41.3347],[-82.6169,41.3231],[-83.0945,41.3964],[-83.6406,41.5905],[-84.3428,41.5876],[-84.8113,41.6282],[-84.9768,41.735],[-85.2195,41.7569],[-86.2125,41.716],[-86.4593,41.756],[-86.5995,41.7256],[-86.8732,41.5949],[-87.1477,41.5721],[-87.4872,41.616],[-87.5251,41.7039],[-87.6303,41.7782],[-87.6298,41.8781]]'::jsonb),
  (2, 'Chicago, IL', -87.6298, 41.8781, 511, 435, null, false, '[[-87.6298,41.8781],[-87.6319,41.848],[-88.1599,41.6368],[-88.1933,41.3144],[-88.3285,41.1729],[-88.446,41.1093],[-88.5748,40.9514],[-88.6689,40.9053],[-88.8217,40.6174],[-88.9374,40.5403],[-89.0243,40.5371],[-89.06,40.3996],[-89.3102,40.1874],[-89.4163,40.1781],[-89.4181,40.099],[-89.5952,39.9098],[-89.6231,39.7465],[-90.1474,39.7377],[-90.2678,39.6807],[-90.8211,39.6701],[-91.2957,39.7567],[-91.364,39.7185],[-91.7546,39.6583],[-91.9253,39.6672],[-92.2559,39.7526],[-93.1091,39.7806],[-93.5824,39.7736],[-93.6294,39.7367],[-94.2214,39.7539],[-94.2825,39.5208],[-94.4185,39.2822],[-94.5576,39.1698],[-94.5786,39.0997]]'::jsonb),
  (3, 'Kansas City, MO', -94.5786, 39.0997, 596, 479, null, false, '[[-94.5786,39.0997],[-94.848,39.1052],[-95.2565,38.9899],[-95.6512,39.0349],[-95.7061,39.0705],[-96.686,39.0655],[-96.8518,38.9998],[-97.6078,38.8767],[-98.2188,38.8481],[-99.0811,38.8626],[-99.9301,39.0229],[-100.1678,39.0243],[-100.3273,39.0972],[-100.7986,39.1129],[-101.0411,39.3649],[-101.3129,39.3663],[-101.3957,39.3306],[-102.0649,39.3294],[-102.2719,39.2944],[-103.6604,39.2613],[-103.8192,39.3059],[-104.1241,39.6868],[-104.3175,39.7339],[-104.8318,39.7295]]'::jsonb),
  (4, 'Aurora, CO', -104.8319, 39.7294, 460, 475, 'I-70 W through Glenwood Canyon and Eisenhower Tunnel', true, '[[-104.8318,39.7295],[-104.8319,39.7734],[-105.1239,39.7842],[-105.2109,39.6955],[-105.6282,39.7661],[-105.7266,39.6946],[-105.8631,39.7015],[-106.0457,39.6397],[-106.1642,39.5018],[-106.3117,39.6463],[-106.4505,39.6084],[-106.6307,39.6566],[-106.7005,39.7121],[-106.838,39.6542],[-107.0776,39.6454],[-107.244,39.5575],[-107.5312,39.5706],[-107.8479,39.5203],[-108.021,39.4738],[-108.1673,39.3724],[-108.3296,39.118],[-108.6562,39.1097],[-108.9085,39.233],[-109.1143,39.1881],[-109.4202,38.9341],[-109.7214,38.9622],[-109.9461,38.9209],[-110.2337,38.9814],[-110.3771,38.9247],[-110.3602,38.8716],[-110.5426,38.6692],[-110.7019,38.3758],[-111.0289,38.3332],[-111.0765,38.268],[-111.3575,38.3262],[-111.4194,38.3002]]'::jsonb),
  (5, 'Torrey, UT', -111.4194, 38.3, 410, 495, 'Bryce Canyon National Park (Scenic Byway 12)', true, '[[-111.4194,38.3002],[-111.3428,38.2222],[-111.353,38.1878],[-111.3257,38.1191],[-111.3458,38.0924],[-111.3312,38.0353],[-111.4299,37.9946],[-111.4247,37.9017],[-111.4587,37.8923],[-111.4011,37.8055],[-111.4152,37.7727],[-111.4476,37.7432],[-111.4898,37.7487],[-111.5261,37.7266],[-111.6217,37.7775],[-111.696,37.7609],[-111.7089,37.7415],[-111.7789,37.7234],[-111.8527,37.624],[-111.9292,37.5921],[-111.9672,37.6023],[-111.9918,37.5632],[-112.0191,37.5588],[-112.0563,37.5705],[-112.0816,37.6506],[-112.1146,37.6844],[-112.1525,37.6927],[-112.1715,37.5951],[-112.1522,37.6927],[-112.3021,37.7446],[-112.3769,37.7497],[-112.4007,37.6776],[-112.4668,37.6123],[-112.5389,37.4252],[-112.5946,37.3735],[-112.599,37.3075],[-112.6497,37.2711],[-112.6853,37.2049],[-112.5725,37.1523],[-112.5344,37.0485],[-112.4441,37.0229],[-112.2173,37.0423],[-111.9857,37.1859],[-111.9749,37.1241],[-111.6775,37.0836],[-111.4742,36.933],[-111.5286,36.7867],[-111.5534,36.7776],[-111.6323,36.6665],[-111.6571,36.5969],[-111.5845,36.5075],[-111.5038,36.347],[-111.3957,36.2156],[-111.3929,35.9936],[-111.4137,35.8701],[-111.4249,35.8551],[-111.4777,35.8588],[-111.5696,35.9192],[-111.6636,35.9393],[-111.7594,35.9236],[-111.83,36.0394],[-111.9722,35.9682],[-112.0647,36.012],[-112.0852,36.0463],[-112.1236,36.0396],[-112.1401,36.0542]]'::jsonb),
  (6, 'Grand Canyon, AZ', -112.1401, 36.0544, 279, 251, null, false, '[[-112.1401,36.0542],[-112.1203,36.0132],[-112.1313,35.7131],[-112.1775,35.4772],[-112.1665,35.3453],[-112.1415,35.2971],[-112.1509,35.2611],[-112.1841,35.2633],[-112.2395,35.2251],[-112.2812,35.2196],[-112.5422,35.2212],[-112.6604,35.2398],[-112.9296,35.3228],[-113.1183,35.2867],[-113.3167,35.1902],[-113.412,35.195],[-113.5574,35.159],[-113.6971,35.1594],[-113.997,35.2174],[-114.0487,35.2143],[-114.0686,35.1912],[-114.1267,35.2222],[-114.4651,35.6789],[-114.5198,35.7832],[-114.623,35.8913],[-114.6488,35.9511],[-114.7501,36.0154],[-114.8155,36.0059],[-114.855,35.9696],[-114.9113,35.9689],[-114.9323,35.9948],[-114.9849,36.0052],[-115.041,36.0781],[-115.0797,36.097],[-115.0893,36.1351],[-115.1399,36.1697]]'::jsonb),
  (7, 'Las Vegas, NV', -115.1398, 36.1699, 270, 245, null, false, '[[-115.1399,36.1697],[-115.1806,36.1311],[-115.1842,35.9442],[-115.3542,35.7454],[-115.4526,35.4697],[-115.5889,35.4739],[-115.9117,35.3681],[-116.088,35.2542],[-116.1221,35.2002],[-116.1542,35.1933],[-116.263,35.1026],[-116.4007,35.0786],[-116.7232,34.9284],[-116.8974,34.9013],[-116.9712,34.9084],[-117.0636,34.8824],[-117.0991,34.8082],[-117.1946,34.7219],[-117.2167,34.6466],[-117.3402,34.4782],[-117.4407,34.3534],[-117.4817,34.343],[-117.4133,34.2083],[-117.5394,34.1002],[-117.5468,34.068],[-117.6832,34.0873],[-117.8122,34.064],[-118.1441,34.0718],[-118.2436,34.0523]]'::jsonb),
  (8, 'Los Angeles, CA', -118.2437, 34.0522, null, null, null, false, null);


-- Carry across everything that was keyed by index.
--
-- rest nights and place notes were keyed by stop index, which is the seeded
-- position; drive notes were keyed by leg number, and leg N leaves the stop at
-- position N-1.
update route_stops s set rest_nights = p.rest_nights, note = p.note
  from plan_stops p where s.position = p.stop;

update route_stops s set drive_note = l.note
  from plan_legs l where s.position = l.leg - 1;


-- Progress stops being a count of legs and becomes the stop you have reached,
-- because a count renumbers the moment a city is inserted behind it.
alter table plan_trip add column done_stop_id uuid references route_stops(id) on delete set null;

update plan_trip t set done_stop_id = (
  select s.id from route_stops s where s.position = t.done_legs
) where t.done_legs > 0;

alter table plan_trip drop column done_legs;

drop table plan_legs;
drop table plan_stops;
